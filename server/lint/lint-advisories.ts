import { runtime } from "#devroom/runtime";
import ts from "typescript";
import { DIST_DIR, SCRIPT_LABEL, SCRIPT_PATH } from "../core/paths.ts";
import { analyzeSource } from "../script/script-stats.ts";
import { createDeviceProgram, typeCheckInputs } from "./lint-types.ts";
import { lintComplexity } from "./lint-complexity.ts";
import { lintMemory } from "./lint-memory.ts";
import {
  calleeName,
  createSink,
  parseSource,
  stringArg,
  type Finding,
  type FindingFix,
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

function unusedFunctionFix(
  source: ts.SourceFile,
  position: number,
): FindingFix | undefined {
  let node: ts.FunctionDeclaration | undefined;
  const visit = (candidate: ts.Node) => {
    if (position < candidate.getFullStart() || position >= candidate.getEnd()) return;
    if (
      ts.isFunctionDeclaration(candidate) &&
      candidate.name &&
      position >= candidate.name.getStart(source) &&
      position < candidate.name.getEnd()
    ) {
      node = candidate;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(source);
  if (!node?.name || !node.body) return undefined;
  const functionName = node.name.text;
  const parent = node.parent;
  const siblings = ts.isSourceFile(parent) || ts.isBlock(parent) ? parent.statements : [];
  const declarations = siblings.filter(
    (item) => ts.isFunctionDeclaration(item) && item.name?.text === functionName,
  );
  if (declarations.length !== 1) return undefined;
  return {
    title: `Remove unused function "${functionName}"`,
    start: node.getStart(source),
    end: node.getEnd(),
    text: "",
  };
}

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

/**
 * 5.4 — every unused declaration costs bytes and JsVars. Delegated to `tsc`
 * rather than a hand-rolled scope pass, and downgraded to a warning.
 *
 * `hasDeclarations` is false when no `types/*.d.ts` were readable (the static
 * build's VFS seeds none): the rule then reports nothing, so its `needs:
 * "types"` catalog tag can report `skipped` instead of a partial verdict.
 */
export function deadCodeFindings(
  path: string,
  fileName: string,
  files: ReadonlyMap<string, string>,
  hasDeclarations = true,
): Finding[] {
  if (!hasDeclarations) return [];
  const { program, source } = createDeviceProgram(path, files, {
    noUnusedLocals: true,
    noUnusedParameters: true,
  });
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
      fix: unusedFunctionFix(source, d.start),
    });
  }
  return findings;
}

async function checkMinifiedMeta(distDir: string): Promise<Finding[]> {
  const candidates = MINIFIED_ARTIFACTS.map((name) => ({
    name,
    path: runtime.path.join(distDir, name),
  }));
  const exists = await Promise.all(
    candidates.map(async ({ path }) => await runtime.fs.exists(path)),
  );
  const present = candidates.filter((_, index) => exists[index]);
  if (!present.length) return [];
  const retained = await Promise.all(
    present.map(async ({ path }) => (await runtime.fs.readText(path)).includes("@meta")),
  );
  const stripped = present
    .filter((_, index) => !retained[index])
    .map(({ name }) => name);
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
  const declared = new Map<string, { name: ts.Node; declaration: ts.Node }>();
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      declared.set(stmt.name.text, { name: stmt.name, declaration: stmt });
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) {
          declared.set(d.name.text, { name: d.name, declaration: d });
        }
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

  for (const [name, site] of declared) {
    if (used.has(name)) continue;
    sink.at(
      site.name,
      "dead-code",
      "warn",
      `'${name}' is declared but never used — it still costs bytes and JsVars on the device`,
      ts.isFunctionDeclaration(site.declaration)
        ? unusedFunctionFix(sf, site.name.getStart(sf))
        : undefined,
    );
  }
}

export function lintAdvisories(
  source: string,
  fileName = SCRIPT_LABEL,
  _distDir = DIST_DIR,
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
  sink.findings.push(...lintMemory(sf, fileName));
  sink.findings.push(...lintComplexity(sf, fileName));

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

  return sink.findings;
}

export async function lintAdvisoriesFile(path = SCRIPT_PATH): Promise<Finding[]> {
  if (!(await runtime.fs.exists(path))) {
    throw new Error(`script not found: ${path}`);
  }
  const fileName = SCRIPT_LABEL;
  const { source, files, declarations } = await typeCheckInputs(path);
  const findings = lintAdvisories(source, fileName);
  if (parseMeta(source)) findings.push(...await checkMinifiedMeta(DIST_DIR));
  findings.push(...deadCodeFindings(path, fileName, files, declarations.length > 0));
  return findings;
}
