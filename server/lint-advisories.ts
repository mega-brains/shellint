import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { DIST_DIR, ROOT, SCRIPT_PATH } from "./paths.ts";
import { analyzeSource } from "./script-stats.ts";
import {
  calleeName,
  createSink,
  parseSource,
  stringArg,
  type Finding,
  type Sink,
} from "./lint-util.ts";

/**
 * Tier 5 — size and cost advisories. All warns: they inform the size dashboard
 * rather than block a build.
 */
export const ADVISORY_LIMITS = {
  maxConsoleLogs: 20,
  maxStringBytes: 1024,
};

const LOG_CALLS = ["console.log", "console.error", "console.warn", "print"];
const MINIFIED_ARTIFACTS = ["debug.js", "prod.js"];
/** "declared but its value is never read" and friends. */
const UNUSED_CODES = new Set([6133, 6138, 6192, 6196, 6198, 6199]);

/** The prod build only strips logs that sit behind a meta.env guard. */
function isDebugGuard(text: string): boolean {
  return (
    text.includes("meta.env.debug") ||
    /!\s*meta\.env\.prod/.test(text) ||
    /meta\.env\.prod\s*===?\s*false/.test(text)
  );
}

type MetaBlock = { roles: string[]; raw: string } | null;

/** `// @meta {"vc":{"temp":{…}}}` — load-bearing, and minifiers strip comments. */
export function parseMeta(source: string): MetaBlock {
  const match = /@meta\s*(\{[\s\S]*?\})\s*(?:\*\/|$)/m.exec(source);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]!) as { vc?: Record<string, unknown> };
    return { roles: Object.keys(parsed.vc ?? {}), raw: match[1]! };
  } catch {
    return { roles: [], raw: match[1]! };
  }
}

function typeDeclarationFiles(): string[] {
  const dir = join(ROOT, "types");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".d.ts"))
    .map((f) => join(dir, f));
}

/**
 * 5.4 — every unused declaration costs bytes and JsVars. Delegated to `tsc`
 * rather than a hand-rolled scope pass, and downgraded to a warning.
 */
export function deadCodeFindings(path: string, fileName: string): Finding[] {
  const program = ts.createProgram([path, ...typeDeclarationFiles()], {
    noEmit: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    target: ts.ScriptTarget.ES5,
    lib: ["lib.es5.d.ts"],
    skipLibCheck: true,
    types: [],
  });
  const source = program.getSourceFile(path);
  if (!source) return [];

  const findings: Finding[] = [];
  for (const d of program.getSemanticDiagnostics(source)) {
    if (!UNUSED_CODES.has(d.code) || d.start == null) continue;
    const { line } = source.getLineAndCharacterOfPosition(d.start);
    findings.push({
      severity: "warn",
      rule: "dead-code",
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
      file: fileName,
      line: line + 1,
    });
  }
  return findings;
}

function checkMinifiedMeta(distDir: string): Finding[] {
  const present = MINIFIED_ARTIFACTS.filter((f) => existsSync(join(distDir, f)));
  if (!present.length) return [];
  const stripped = present.filter(
    (f) => !readFileSync(join(distDir, f), "utf8").includes("@meta"),
  );
  if (!stripped.length) return [];
  return [
    {
      severity: "warn",
      rule: "@meta-must-survive",
      message: `@meta comment missing from ${stripped.join(", ")} — the device needs it to create the virtual components`,
    },
  ];
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  return (
    ((ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent)) &&
      parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node)
  );
}

/**
 * `noUnusedLocals` only sees locals, and a flat device script declares almost
 * everything at top level — where it is a global. This covers that half.
 */
function unusedGlobals(sf: ts.SourceFile, sink: Sink) {
  const declared = new Map<string, ts.Node>();
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      declared.set(stmt.name.text, stmt.name);
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) declared.set(d.name.text, d.name);
      }
    }
  }
  if (!declared.size) return;

  const used = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && !isDeclarationName(node)) used.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);

  for (const [name, node] of declared) {
    if (used.has(name)) continue;
    sink.at(
      node,
      "dead-code",
      "warn",
      `'${name}' is declared but never used — it still costs bytes and JsVars on the device`,
    );
  }
}

export function lintAdvisories(
  source: string,
  fileName = "scripts/main.ts",
  distDir = DIST_DIR,
): Finding[] {
  const sf = parseSource(source, fileName);
  const sink = createSink(sf, fileName);
  const meta = parseMeta(source);
  const guards: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && LOG_CALLS.includes(name) && !guards.some(isDebugGuard)) {
        sink.at(
          node,
          "no-debug-log-in-prod",
          "warn",
          `${name} is not behind a meta.env.debug guard — it ships in the prod build`,
        );
      }
      if (name === "Script.getVcHandle" && meta) {
        const role = stringArg(node, 0);
        if (role && !meta.roles.includes(role)) {
          sink.at(
            node,
            "meta-vc-role-matches",
            "warn",
            meta.roles.length
              ? `virtual component "${role}" is not declared in @meta (declared: ${meta.roles.join(", ")})`
              : `virtual component "${role}" cannot be matched — @meta holds no readable "vc" object`,
          );
        }
      }
    }

    const guard = ts.isIfStatement(node)
      ? node.expression
      : ts.isConditionalExpression(node)
        ? node.condition
        : null;
    if (guard) guards.push(guard.getText(sf));
    ts.forEachChild(node, visit);
    if (guard) guards.pop();
  };

  visit(sf);
  unusedGlobals(sf, sink);

  const stats = analyzeSource(source, fileName);
  const logs = stats.logging.consoleLog + stats.logging.print;
  if (logs > ADVISORY_LIMITS.maxConsoleLogs) {
    sink.file(
      "excessive-console-log",
      "warn",
      `${logs} log calls — the device log buffer is circular and logging costs CPU on a cooperative scheduler`,
    );
  }

  const stringBytes = stats.literals.strings.totalBytes;
  if (stringBytes > ADVISORY_LIMITS.maxStringBytes) {
    sink.file(
      "prefer-short-strings",
      "warn",
      `${stringBytes} B of string literals — every literal is resident RAM on the device`,
    );
  }

  if (meta) sink.findings.push(...checkMinifiedMeta(distDir));

  return sink.findings;
}

export function lintAdvisoriesFile(path = SCRIPT_PATH): Finding[] {
  if (!existsSync(path)) {
    throw new Error(`script not found: ${path}`);
  }
  const fileName = "scripts/main.ts";
  return [
    ...lintAdvisories(readFileSync(path, "utf8"), fileName),
    ...deadCodeFindings(path, fileName),
  ];
}
