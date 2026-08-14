/**
 * `ts.transpileModule` wrapper — the browser-worker replacement for the
 * `tsc -p tsconfig.shelly.json` spawn in scripts/build-shelly.mjs. A Worker
 * cannot read tsconfig.shelly.json off disk, so its compiler options are
 * inlined below rather than parsed at runtime. That inlining is a duplicated
 * source of truth, so scripts/test-transpile-parity.mjs asserts this object
 * stays equivalent to what tsconfig.shelly.json itself parses to — a future
 * tsconfig edit fails that test loudly instead of silently drifting the two
 * apart. `ts.transpileModule` with these options is byte-identical to
 * `tsc -p` (locked by that same test, M17.2).
 */
import ts from "typescript";

/**
 * Mirrors tsconfig.shelly.json's `compilerOptions` verbatim (see that file
 * for why each one is set) minus `rootDir`/`outDir`/`configFilePath`, which
 * only steer a Program's disk IO and are inert for `transpileModule` (it has
 * no Program and never touches disk).
 */
export const DEVICE_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES5,
  module: ts.ModuleKind.None,
  strict: true,
  noEmitHelpers: true,
  importHelpers: false,
  downlevelIteration: false,
  useDefineForClassFields: false,
  isolatedModules: false,
  skipLibCheck: true,
  noLib: true,
  types: [],
  removeComments: false,
};

/**
 * @param source device script text
 * @param fileName original file name — its extension picks `allowJs` and
 *   steers `transpileModule`'s own scriptKind inference (.ts vs .js syntax).
 */
export function transpileDevice(source: string, fileName: string): string {
  const isJs = /\.(m|c)?js$/i.test(fileName);
  const compilerOptions = isJs
    ? { ...DEVICE_COMPILER_OPTIONS, allowJs: true }
    : DEVICE_COMPILER_OPTIONS;
  return ts.transpileModule(source, { compilerOptions, fileName }).outputText;
}
