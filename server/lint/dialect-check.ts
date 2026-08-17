import { runtime } from "#devroom/runtime";
import ts from "typescript";
import { DIST_DIR } from "../core/paths.ts";
import { calleeName, definesAccessor, hasUnicodeEscape } from "./lint-util.ts";

export type DialectFinding = {
  rule: string;
  severity: "error" | "warn";
  message: string;
  line?: number;
};

export type DialectReport = {
  file: string;
  ok: boolean;
  findings: DialectFinding[];
};

/**
 * Registration caps re-counted on emitted code — same thresholds as Tier 2.
 * Counted on the AST walk below, so a `Timer.set(` inside a string or a
 * comment is not mistaken for a registration.
 */
const EMIT_CAPS: Record<string, { rule: string; limit: number }> = {
  "Timer.set": { rule: "max-timers", limit: 5 },
  "Shelly.addEventHandler": { rule: "max-event-handlers", limit: 5 },
  "Shelly.addStatusHandler": { rule: "max-status-handlers", limit: 5 },
  "HTTPServer.registerEndpoint": { rule: "max-http-endpoints", limit: 5 },
  "Script.addRpcHandler": { rule: "max-rpc-handlers", limit: 5 },
};

/**
 * Post-compile dialect guard on emitted ES5 (Tier 1 subset).
 * Catches compiler regressions / helpers that sneak banned syntax onto device.
 */
export function checkDialectSource(
  source: string,
  fileName: string,
): DialectReport {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES5,
    true,
    ts.ScriptKind.JS,
  );
  const findings: DialectFinding[] = [];
  const registrations = new Map<string, number>();

  const add = (
    node: ts.Node,
    rule: string,
    severity: "error" | "warn",
    message: string,
  ) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ rule, severity, message, line: line + 1 });
  };

  const visit = (node: ts.Node) => {
    if (ts.isRegularExpressionLiteral(node)) {
      add(node, "no-regexp", "error", "RegExp literal not supported on device");
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "RegExp"
    ) {
      add(node, "no-regexp", "error", "new RegExp() not supported on device");
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "RegExp"
    ) {
      add(node, "no-regexp", "error", "RegExp() not supported on device");
    }
    if (ts.isArrowFunction(node)) {
      add(node, "no-arrow-functions", "error", "arrow functions not supported");
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      add(node, "no-classes", "error", "classes not supported");
    }
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // tsc usually rewrites these; flag if any survive
      add(node, "no-template-literals", "error", "template literals not supported");
    }
    if (ts.isAwaitExpression(node)) {
      add(node, "no-async", "error", "await not supported");
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    ) {
      add(node, "no-async", "error", "async functions not supported");
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)) &&
      node.asteriskToken
    ) {
      add(node, "no-generators", "error", "generator functions not supported");
    }
    if (ts.isYieldExpression(node)) {
      add(node, "no-generators", "error", "yield not supported");
    }
    if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      add(node, "no-accessors", "error", "get/set accessors not supported");
    }
    // The shape a class getter takes once tsc has down-levelled it to ES5 —
    // the one accessor form the guard can actually expect to meet.
    if (ts.isCallExpression(node) && definesAccessor(node)) {
      add(
        node,
        "no-accessors",
        "error",
        "Object.defineProperty with a get/set descriptor defines an accessor",
      );
    }
    if (ts.isLabeledStatement(node)) {
      add(node, "no-labeled-statements", "warn", "labeled statement unverified on device");
    }
    if (ts.isWithStatement(node)) {
      add(node, "no-with", "warn", "with statement unverified on device");
    }
    if (ts.isStringLiteral(node) && hasUnicodeEscape(node.getText(sf))) {
      add(
        node,
        "no-unicode-escapes",
        "warn",
        "only \\xHH escapes are supported in device strings",
      );
    }
    if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
      add(node, "no-destructuring", "error", "destructuring not supported");
    }
    if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
      add(node, "no-spread-rest", "error", "spread not supported");
    }
    if (ts.isBindingElement(node) && node.dotDotDotToken) {
      add(node, "no-spread-rest", "error", "rest element not supported");
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node, "no-modules", "error", "ES modules not supported on device");
    }

    // Resource counts on emitted code (warn)
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && EMIT_CAPS[name]) {
        registrations.set(name, (registrations.get(name) ?? 0) + 1);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);

  for (const [label, cap] of Object.entries(EMIT_CAPS)) {
    const n = registrations.get(label) ?? 0;
    if (n > cap.limit) {
      findings.push({
        rule: cap.rule,
        severity: "warn",
        message: `${label} count ${n} exceeds device cap ${cap.limit}`,
      });
    }
  }

  const ok = !findings.some((f) => f.severity === "error");
  return { file: fileName, ok, findings };
}

/** Suffixes of every artifact the build can emit, in ship order. */
const ARTIFACT_SUFFIXES = ["raw.js", "js", "adv.js"] as const;

export async function checkBuildArtifacts(
  modes: Array<"debug" | "prod"> = ["debug", "prod"],
): Promise<DialectReport[]> {
  const reports: DialectReport[] = [];
  for (const mode of modes) {
    for (const suffix of ARTIFACT_SUFFIXES) {
      const fileName = `${mode}.${suffix}`;
      const path = runtime.path.join(DIST_DIR, fileName);
      if (!(await runtime.fs.exists(path))) continue;
      reports.push(checkDialectSource(await runtime.fs.readText(path), fileName));
    }
  }
  return reports;
}
