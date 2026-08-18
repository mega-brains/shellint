/**
 * Tier-3 ("advanced") minify, in-browser: the same esprima -> esmangle ->
 * escodegen sequence node_modules/espruino/plugins/minify.js runs under its
 * `case "ESPRIMA"` branch (`minifyCodeEsprima` / `obfuscate`), reimplemented
 * directly here instead of importing that whole plugin, which expects a
 * global `Espruino.Core.*` app we don't have. The vendored libs
 * (./vendor/espruino-entry.js) are loaded lazily on first use — most builds
 * never touch tier 3 (shellint.json `advanced` defaults false), and the
 * libs are ~450 KB.
 *
 * `@meta` re-attach + terser-parse validation is shared with the Node CLI
 * transport (scripts/minify-adv.mjs) via shared/minify-adv-core.mjs, so both
 * apply the identical safety net. Contract mirrors minifyAdvanced there:
 * `{ ok: false, reason }` on any failure, never a thrown error.
 */
import { reattachMetaAndValidate } from "../../shared/minify-adv-core.mjs";
import { loadEspruinoLibs } from "./vendor/espruino-entry.js";

export type MinifyAdvancedResult =
  | { ok: true; code: string; engine: string }
  | { ok: false; reason: string };

const ENGINE = "espruino-esprima";

/** `option` in minifyCodeEsprima (node_modules/espruino/plugins/minify.js). */
const GENERATE_OPTIONS = {
  format: {
    renumber: true,
    hexadecimal: true,
    escapeless: false,
    indent: { style: "" },
    quotes: "auto",
    compact: true,
    semicolons: false,
    parentheses: false,
  },
};

/** `obfuscate`'s esmangle.optimize config, mangle always on (matches this project's Terser mangle default). */
const OPTIMIZE_OPTIONS = {
  destructive: true,
  directive: true,
  preserveCompletionValue: false,
  legacy: false,
  topLevelContext: false,
  inStrictCode: false,
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function minifyAdvancedBrowser(
  code: string,
): Promise<MinifyAdvancedResult> {
  let libs;
  try {
    libs = await loadEspruinoLibs();
  } catch (err) {
    return { ok: false, reason: `espruino libs failed to load (${errorMessage(err)})` };
  }
  if (!libs) {
    return { ok: false, reason: "espruino libs not loaded" };
  }

  let out: string;
  try {
    let syntax = libs.esprima.parse(code, { raw: true, loc: true });
    syntax = libs.esmangle.optimize(syntax, null, OPTIMIZE_OPTIONS);
    syntax = libs.esmangle.mangle(syntax);
    out = libs.escodegen.generate(syntax, GENERATE_OPTIONS);
  } catch (err) {
    return { ok: false, reason: `espruino minify failed (${errorMessage(err)})` };
  }
  if (!out.trim()) {
    return { ok: false, reason: "espruino produced empty output" };
  }

  const result = await reattachMetaAndValidate(code, out);
  if (!result.ok) return result;
  return { ok: true, code: result.code, engine: ENGINE };
}
