import { runtime } from "#shellint/runtime";
import ts from "typescript";
import { DIST_DIR } from "../core/paths.ts";
import {
  calleeName,
  definesAccessor,
  hasUnicodeEscape,
  isFunctionLike,
  isNamedCallee,
} from "./lint-util.ts";

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

type NodeRule = {
  rule: string;
  severity: "error" | "warn";
  message: string;
  match: (node: ts.Node, sf: ts.SourceFile) => boolean;
};

/**
 * One entry per banned construct, applied in order to every node — the order is
 * the order findings come out in, which the artifact tests compare against.
 */
const NODE_RULES: NodeRule[] = [
  {
    rule: "no-regexp",
    severity: "error",
    message: "RegExp literal not supported on device",
    match: (n) => ts.isRegularExpressionLiteral(n),
  },
  {
    rule: "no-regexp",
    severity: "error",
    message: "new RegExp() not supported on device",
    match: (n) => ts.isNewExpression(n) && isNamedCallee(n, "RegExp"),
  },
  {
    rule: "no-regexp",
    severity: "error",
    message: "RegExp() not supported on device",
    match: (n) => ts.isCallExpression(n) && isNamedCallee(n, "RegExp"),
  },
  {
    rule: "no-arrow-functions",
    severity: "error",
    message: "arrow functions not supported",
    match: (n) => ts.isArrowFunction(n),
  },
  {
    rule: "no-classes",
    severity: "error",
    message: "classes not supported",
    match: (n) => ts.isClassDeclaration(n) || ts.isClassExpression(n),
  },
  {
    // tsc usually rewrites these; flag if any survive
    rule: "no-template-literals",
    severity: "error",
    message: "template literals not supported",
    match: (n) =>
      ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n),
  },
  {
    rule: "no-async",
    severity: "error",
    message: "await not supported",
    match: (n) => ts.isAwaitExpression(n),
  },
  {
    rule: "no-async",
    severity: "error",
    message: "async functions not supported",
    match: (n) =>
      isFunctionLike(n) &&
      !!n.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
  },
  {
    rule: "no-generators",
    severity: "error",
    message: "generator functions not supported",
    match: (n) => isFunctionLike(n) && !!n.asteriskToken,
  },
  {
    rule: "no-generators",
    severity: "error",
    message: "yield not supported",
    match: (n) => ts.isYieldExpression(n),
  },
  {
    rule: "no-accessors",
    severity: "error",
    message: "get/set accessors not supported",
    match: (n) =>
      ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n),
  },
  {
    // The shape a class getter takes once tsc has down-levelled it to ES5 —
    // the one accessor form the guard can actually expect to meet.
    rule: "no-accessors",
    severity: "error",
    message:
      "Object.defineProperty with a get/set descriptor defines an accessor",
    match: (n) => ts.isCallExpression(n) && definesAccessor(n),
  },
  {
    rule: "no-labeled-statements",
    severity: "warn",
    message: "labeled statement unverified on device",
    match: (n) => ts.isLabeledStatement(n),
  },
  {
    rule: "no-with",
    severity: "warn",
    message: "with statement unverified on device",
    match: (n) => ts.isWithStatement(n),
  },
  {
    rule: "no-unicode-escapes",
    severity: "warn",
    message: "only \\xHH escapes are supported in device strings",
    match: (n, sf) => ts.isStringLiteral(n) && hasUnicodeEscape(n.getText(sf)),
  },
  {
    rule: "no-destructuring",
    severity: "error",
    message: "destructuring not supported",
    match: (n) =>
      ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n),
  },
  {
    rule: "no-spread-rest",
    severity: "error",
    message: "spread not supported",
    match: (n) => ts.isSpreadElement(n) || ts.isSpreadAssignment(n),
  },
  {
    rule: "no-spread-rest",
    severity: "error",
    message: "rest element not supported",
    match: (n) => ts.isBindingElement(n) && !!n.dotDotDotToken,
  },
  {
    rule: "no-modules",
    severity: "error",
    message: "ES modules not supported on device",
    match: (n) => ts.isImportDeclaration(n) || ts.isExportDeclaration(n),
  },
];

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
    for (const r of NODE_RULES) {
      if (r.match(node, sf)) add(node, r.rule, r.severity, r.message);
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
