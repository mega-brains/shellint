/**
 * The TypeScript layer of Check: does the saved script parse, and does it
 * type-check against `types/*.d.ts` — the whole device stdlib under `noLib`?
 *
 * Build already reports these, but only as a one-line status message. Routing
 * them through Check as ordinary findings is what puts them in the check pane
 * *and* on the editor gutter (`web/editor/finding-gutter.tsx` marks any finding
 * whose `file` is `scripts/main.ts`), identically on Node, txiki, the txiki
 * single-file executable and the static build — all four share this module.
 */
import { runtime } from "#devroom/runtime";
import ts from "typescript";
import { DEVICE_COMPILER_OPTIONS } from "../../web/static/transpile.ts";
import { ROOT, SCRIPT_PATH } from "../core/paths.ts";
import type { Finding } from "./lint-util.ts";

export const SCRIPT_FILE = "scripts/main.ts";

export async function typeDeclarationFiles(): Promise<string[]> {
  const dir = runtime.path.join(ROOT, "types");
  if (!(await runtime.fs.exists(dir))) return [];
  return (await runtime.fs.readDir(dir))
    .filter((entry) => entry.isFile && entry.name.endsWith(".d.ts"))
    .map((entry) => runtime.path.join(dir, entry.name));
}

/**
 * A Program over an in-memory file set only — no `ts.sys`, so it also runs in
 * the browser worker of the static build.
 */
export function createDeviceProgram(
  sourcePath: string,
  files: ReadonlyMap<string, string>,
  extraOptions: ts.CompilerOptions = {},
): { program: ts.Program; source: ts.SourceFile | undefined } {
  const normalize = (name: string) => runtime.path.resolve(name);
  const sources = new Map([...files].map(([name, text]) => [normalize(name), text]));
  const options: ts.CompilerOptions = {
    ...DEVICE_COMPILER_OPTIONS,
    noEmit: true,
    ...extraOptions,
  };
  const canonical = (name: string) =>
    runtime.process.platform === "win32" ? normalize(name).toLowerCase() : normalize(name);
  const host: ts.CompilerHost = {
    getSourceFile(name, languageVersion) {
      const text = sources.get(normalize(name));
      return text === undefined
        ? undefined
        : ts.createSourceFile(name, text, languageVersion, true, ts.ScriptKind.TS);
    },
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => ROOT,
    getDirectories: () => [],
    fileExists: (name) => sources.has(normalize(name)),
    readFile: (name) => sources.get(normalize(name)),
    getCanonicalFileName: canonical,
    useCaseSensitiveFileNames: () => runtime.process.platform !== "win32",
    getNewLine: () => "\n",
    directoryExists(name) {
      const prefix = `${normalize(name)}${runtime.path.sep}`;
      return [...sources.keys()].some((candidate) => candidate.startsWith(prefix));
    },
    realpath: normalize,
  };
  const rootPath = normalize(sourcePath);
  const rootNames = [
    rootPath,
    ...[...sources.keys()].filter((name) => name !== rootPath),
  ];
  const program = ts.createProgram({ rootNames, options, host });
  return { program, source: program.getSourceFile(rootPath) };
}

/**
 * Only diagnostics anchored at a position in the source. A file-less one is a
 * complaint about the *options* rather than the script — `transpileModule`
 * forces `isolatedModules`, which under the device's `module: none` + ES5
 * target emits TS5047 — and it would otherwise fail Check on every source.
 */
function isPositioned(diagnostic: ts.Diagnostic): boolean {
  return diagnostic.file != null && diagnostic.start != null;
}

function findingFor(
  diagnostic: ts.Diagnostic,
  rule: string,
  source: ts.SourceFile,
): Finding {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  return {
    severity: "error",
    rule,
    message: `TS${diagnostic.code}: ${message}`,
    file: SCRIPT_FILE,
    line: source.getLineAndCharacterOfPosition(diagnostic.start!).line + 1,
  };
}

/**
 * Does the source parse at all?
 *
 * Every other lint pass builds its own `ts.createSourceFile`, and TypeScript's
 * parser *recovers* from a syntax error instead of throwing — so without this
 * pass the rules run over a garbage AST, find nothing, and Check reports
 * `ok: true` on a file that cannot compile. `transpileModule` is the public way
 * to syntactic diagnostics (`sourceFile.parseDiagnostics` is TS-internal), and
 * it needs no `.d.ts` files, so this works even with `types/` missing.
 */
export function lintSyntax(source: string): Finding[] {
  const output = ts.transpileModule(source, {
    fileName: SCRIPT_FILE,
    reportDiagnostics: true,
    compilerOptions: DEVICE_COMPILER_OPTIONS,
  });
  const sourceFile = ts.createSourceFile(
    SCRIPT_FILE,
    source,
    ts.ScriptTarget.ES5,
    true,
    ts.ScriptKind.TS,
  );
  return (output.diagnostics ?? [])
    .filter(
      (diagnostic) =>
        diagnostic.category === ts.DiagnosticCategory.Error && isPositioned(diagnostic),
    )
    .map((diagnostic) => findingFor(diagnostic, "syntax-error", sourceFile));
}

/**
 * Every `tsc` error the device build would report, under exactly the options
 * `tsconfig.shelly.json` uses (`DEVICE_COMPILER_OPTIONS`), so a Check error and
 * a Build failure never disagree.
 *
 * Returns nothing when no `types/*.d.ts` were readable: with the device stdlib
 * absent and `noLib` on, every global would be an unresolved name. The
 * catalog's `needs: "types"` tag then reports the rule as `skipped`.
 */
export function typeErrorFindings(
  sourcePath: string,
  files: ReadonlyMap<string, string>,
  hasDeclarations: boolean,
): Finding[] {
  if (!hasDeclarations) return [];
  const { program, source } = createDeviceProgram(sourcePath, files);
  if (!source) return [];
  return ts
    .getPreEmitDiagnostics(program, source)
    .filter(
      (diagnostic) =>
        diagnostic.category === ts.DiagnosticCategory.Error &&
        isPositioned(diagnostic) &&
        // A `.d.ts`-anchored diagnostic would resolve its line against the
        // wrong file, and is not the script author's to fix anyway.
        diagnostic.file === source,
    )
    .map((diagnostic) => findingFor(diagnostic, "type-error", source));
}

/** Source + every `types/*.d.ts`, the file set both TS passes need. */
export async function typeCheckInputs(
  path = SCRIPT_PATH,
): Promise<{ source: string; files: Map<string, string>; declarations: string[] }> {
  const source = await runtime.fs.readText(path);
  const declarations = await typeDeclarationFiles();
  const declarationSources = await Promise.all(
    declarations.map(
      async (declaration) => [declaration, await runtime.fs.readText(declaration)] as const,
    ),
  );
  return {
    source,
    files: new Map<string, string>([[path, source], ...declarationSources]),
    declarations,
  };
}
