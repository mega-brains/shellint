/**
 * A `ts.createProgram`-safe wrapper around the real `typescript` package,
 * aliased in globally for the static/offline bundle (`scripts/static-esbuild.mjs`
 * aliases the bare `"typescript"` specifier to this file) so every
 * `import ts from "typescript"` in the bundled `server/lint/*` graph resolves
 * here instead of the raw module.
 *
 * Why this exists: `server/lint/lint-advisories.ts`'s `deadCodeFindings()`
 * unconditionally calls `ts.createProgram(...)` with no explicit host — Tier
 * 5's `dead-code` rule is *not* actually gated by its `needs: "types"`
 * catalog tag; that tag only governs the reported skip status in
 * `check-catalog.ts`, not whether the underlying code runs. TypeScript's
 * Program API cannot build a default host without `ts.sys`, and inside any
 * browser-platform esbuild bundle `ts.sys` is unconditionally `undefined` —
 * even after `scripts/static-esbuild.mjs`'s `require: "undefined"` define,
 * which fixes a *different*, earlier crash (merely importing "typescript" at
 * all throws `_os.platform is not a function` without it).
 * `ts.createProgram()` then throws `Cannot read properties of undefined
 * (reading 'useCaseSensitiveFileNames')` while building its default host —
 * verified empirically by executing the bundled output, not just building it.
 *
 * The M17 plan (§8) explicitly defers building a real `ts.sys`/CompilerHost
 * over the VFS, and its M17.4 slice forbids "shimming ts.sys" — this does
 * neither: it never touches `ts.sys`, and does not make `ts.createProgram`
 * succeed against the VFS. It only stops the *throw* from taking the whole
 * `runCheck()` call down — `check.ts`'s findings array is one spread
 * expression across every Tier 1/3/5 rule
 * (`[...lintScriptFile(), ...lintSemanticsFile(), ...lintAdvisoriesFile()]`),
 * so an uncaught exception from Tier 5's one dead-code rule would otherwise
 * lose every other rule's findings too. The fallback's `getSourceFile()`
 * always returns `undefined`, which `deadCodeFindings` already treats as
 * "nothing to report" (`if (!source) return [];`) — the same outcome a
 * working `needs: "types"` skip would produce.
 *
 * Patching `ts.createProgram` in place (on the real module) does not work:
 * esbuild's CJS-to-ESM interop exposes every property of a `require()`d
 * module as a non-configurable getter, so `ts.createProgram = …` throws
 * "Cannot set property … which has only a getter" and
 * `Object.defineProperty` throws "Cannot redefine property" (verified
 * empirically). Spreading the real module's exports into a fresh plain
 * object sidesteps that — the copy's properties are ordinary, writable,
 * configurable data properties. The real module is imported by relative path
 * into `node_modules` (not the bare `"typescript"` specifier) so this file's
 * own import does not recursively hit the alias that points `"typescript"`
 * at this file.
 */
import * as realTs from "../../node_modules/typescript/lib/typescript.js";
import type ts from "typescript";

type RealTs = typeof ts;

const safe = { ...(realTs as unknown as RealTs) };
const realCreateProgram = safe.createProgram;

safe.createProgram = ((rootNames: readonly string[], options: ts.CompilerOptions) => {
  try {
    return realCreateProgram(rootNames, options);
  } catch {
    return {
      getSourceFiles: () => [],
      getSourceFile: () => undefined,
      getSemanticDiagnostics: () => [],
    } as unknown as ts.Program;
  }
}) as RealTs["createProgram"];

export default safe;
