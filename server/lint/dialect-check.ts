import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { DIST_DIR } from "../core/paths.ts";

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
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const obj = node.expression.expression;
      const method = node.expression.name.text;
      if (ts.isIdentifier(obj) && obj.text === "Timer" && method === "set") {
        // counted later
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);

  // Registration caps (warn) — same thresholds as Tier 2
  const caps: Array<{ re: RegExp; rule: string; limit: number; label: string }> = [
    { re: /\bTimer\.set\s*\(/g, rule: "max-timers", limit: 5, label: "Timer.set" },
    {
      re: /\bShelly\.addEventHandler\s*\(/g,
      rule: "max-event-handlers",
      limit: 5,
      label: "Shelly.addEventHandler",
    },
    {
      re: /\bShelly\.addStatusHandler\s*\(/g,
      rule: "max-status-handlers",
      limit: 5,
      label: "Shelly.addStatusHandler",
    },
    {
      re: /\bHTTPServer\.registerEndpoint\s*\(/g,
      rule: "max-http-endpoints",
      limit: 5,
      label: "HTTPServer.registerEndpoint",
    },
    {
      re: /\bScript\.addRpcHandler\s*\(/g,
      rule: "max-rpc-handlers",
      limit: 5,
      label: "Script.addRpcHandler",
    },
  ];
  for (const cap of caps) {
    const n = source.match(cap.re)?.length ?? 0;
    if (n > cap.limit) {
      findings.push({
        rule: cap.rule,
        severity: "warn",
        message: `${cap.label} count ${n} exceeds device cap ${cap.limit}`,
      });
    }
  }

  const ok = !findings.some((f) => f.severity === "error");
  return { file: fileName, ok, findings };
}

/** Suffixes of every artifact the build can emit, in ship order. */
const ARTIFACT_SUFFIXES = ["raw.js", "js", "adv.js"] as const;

export function checkBuildArtifacts(
  modes: Array<"debug" | "prod"> = ["debug", "prod"],
): DialectReport[] {
  const reports: DialectReport[] = [];
  for (const mode of modes) {
    for (const suffix of ARTIFACT_SUFFIXES) {
      const fileName = `${mode}.${suffix}`;
      const path = join(DIST_DIR, fileName);
      if (!existsSync(path)) continue;
      reports.push(checkDialectSource(readFileSync(path, "utf8"), fileName));
    }
  }
  return reports;
}
