/**
 * Tier-3 post-processing shared between the Node `espruino` CLI transport
 * (scripts/minify-adv.mjs) and a future browser backend: the CLI drops all
 * comments, so `@meta` blocks are re-attached verbatim; then the result is
 * validated to still parse before it's trusted on a device. Zero node
 * imports — the minifier call itself (subprocess, or vendored esprima/
 * esmangle/escodegen in a worker) stays with each transport.
 */
import { minify } from "terser";

/** The CLI drops all comments, so `@meta` blocks are re-attached verbatim. */
export const META_COMMENT = /\/\*(?:[^*]|\*(?!\/))*@meta(?:[^*]|\*(?!\/))*\*\//g;

/** Terser is only used as a parser here — broken output must not reach a device. */
async function parses(code) {
  try {
    await minify(code, { compress: false, mangle: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} code source given to the minifier
 * @param {string} out raw, already-known-non-empty minifier output
 * @returns {Promise<{ok: true, code: string} | {ok: false, reason: string}>}
 */
export async function reattachMetaAndValidate(code, out) {
  const meta = code.match(META_COMMENT);
  if (meta) {
    const missing = meta.filter((c) => !out.includes(c));
    if (missing.length > 0) out = `${missing.join("\n")}\n${out}`;
  }
  if (!(await parses(out))) {
    return { ok: false, reason: "espruino output does not parse" };
  }
  return { ok: true, code: out };
}
