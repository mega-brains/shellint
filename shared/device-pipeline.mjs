/**
 * Pure device-build transform: meta.env DCE ×2 → optional minify. No disk IO,
 * no `node:` builtins — this is the half of scripts/build-shelly.mjs that a
 * browser Web Worker can run unmodified (M17). `scripts/build-shelly.mjs`
 * re-exports these for its existing callers (tests, scripts/bench-minify.mjs)
 * and wraps them with the tsc spawn + disk writes.
 */
import { minify } from "terser";
import { MINIFY_OPTIONS } from "./minify-options.mjs";
import { shortenLogStrings } from "../scripts/log-shorten.mjs";
import { internStrings } from "../scripts/intern-strings.mjs";

/**
 * `meta.device.*` global_defs from an already-parsed `device-profile.json`
 * object. A missing field substitutes *nothing* for that field — feeding
 * `undefined` into `global_defs` would turn a live branch dead and silently
 * delete working code, which is worse than leaving `meta.device.x`
 * un-substituted. Absent or partial coverage prints a build warning and the
 * build continues.
 * @param {Record<string, unknown>} profile parsed device-profile.json
 * @returns {Record<string, unknown>} zero, one, two, or three `meta.device.*` keys
 */
export function deviceGlobalDefsFrom(profile) {
  /** @type {Record<string, unknown>} */
  const defs = {};
  const missing = [];
  if (typeof profile.gen === "number") {
    defs["meta.device.gen"] = profile.gen;
  } else {
    missing.push("gen");
  }
  if (typeof profile.model === "string") {
    defs["meta.device.model"] = profile.model;
  } else {
    missing.push("model");
  }
  // device-profile.json's own field is `ver` (firmware version); meta.device.fw
  // is this build pipeline's name for it.
  if (typeof profile.ver === "string") {
    defs["meta.device.fw"] = profile.ver;
  } else {
    missing.push("fw (device-profile.json field `ver`)");
  }
  if (missing.length) {
    console.error(
      `deviceDCE: device profile is missing [${missing.join(", ")}] — left un-substituted for those fields`,
    );
  }
  return defs;
}

/**
 * Apply meta.env (+ optional meta.device) literals and DCE only — readable, no
 * mangle. `dropConsole` is honored here too (not only in `minifyPass`) so the
 * `*.raw.js` artifact shown in the editor's artifact preview matches what the
 * shipped `*.js` actually contains.
 */
export async function envPass(code, { debug, prod }, deviceDefs, opts = {}) {
  const result = await minify(code, {
    compress: {
      defaults: false,
      dead_code: true,
      conditionals: true,
      evaluate: true,
      booleans: true,
      if_return: true,
      join_vars: false,
      sequences: false,
      drop_console: !!opts.dropConsole,
      global_defs: {
        "meta.env.debug": debug,
        "meta.env.prod": prod,
        ...deviceDefs,
      },
    },
    mangle: false,
    format: {
      beautify: true,
      comments: /@meta/,
    },
  });
  if (!result.code) {
    throw new Error("env pass produced empty output");
  }
  return result.code;
}

/**
 * Resolve the raw `minify.*` config down to what a given build variant should
 * actually honor, per each option's declared `scope` in
 * shared/minify-options.mjs. This is the only place `scope` is interpreted —
 * `minifyPass` and the rest of `buildVariant` just consume the result and
 * never branch on the variant name themselves.
 * @param {typeof import("./minify-options.d.mts").DEFAULT_MINIFY} minifyOpts
 * @param {"debug" | "prod"} variantName
 * @returns {typeof import("./minify-options.d.mts").DEFAULT_MINIFY}
 */
export function resolveVariantOptions(minifyOpts, variantName) {
  const out = { ...minifyOpts };
  for (const opt of MINIFY_OPTIONS) {
    if (opt.scope === "both") continue;
    if (opt.scope !== variantName) out[opt.key] = false;
  }
  return out;
}

/**
 * Size minify on already-env-substituted code.
 * Options mirror `shellint.json` `minify.*` Terser knobs. `opts` must already
 * be resolved per-variant (see `resolveVariantOptions`) — this function does
 * not know or care which variant it's minifying.
 */
export async function minifyPass(code, opts) {
  const compress = opts.compress !== false;
  const mangle = opts.mangle !== false;
  const toplevel = !!opts.toplevel;
  const keepFnames = !!opts.keepFnames;
  const dropConsole = !!opts.dropConsole;
  const passes = !!opts.passes;
  const hoistProps = !!opts.hoistProps;

  // ecma: 5 is pinned unconditionally on both compress and format so no
  // combination of knobs can ever let Terser emit arrows/templates/etc. onto
  // the device — the post-compile dialect guard (checkBuildArtifacts) then
  // verifies this held.
  let compressOpt = false;
  if (compress) {
    compressOpt = { ecma: 5 };
    if (toplevel) compressOpt.toplevel = true;
    if (keepFnames) compressOpt.keep_fnames = true;
    // Prod-only by construction: opts is already scope-resolved, so
    // dropConsole reads as false here on every debug build regardless of
    // shellint.json — debug artifact exists to be logged.
    if (dropConsole) compressOpt.drop_console = true;
    if (passes) compressOpt.passes = 3;
    if (hoistProps) compressOpt.hoist_props = true;
  } else if (dropConsole) {
    // drop_console is a compress transform: with `compress: false` Terser never
    // runs it, so dropConsole would silently no-op whenever the compress knob
    // is off. Run a compress step that does nothing *but* drop console.*.
    compressOpt = { ecma: 5, defaults: false, drop_console: true };
  }

  let mangleOpt = false;
  if (mangle) {
    if (toplevel || keepFnames) {
      mangleOpt = {};
      if (toplevel) mangleOpt.toplevel = true;
      if (keepFnames) mangleOpt.keep_fnames = true;
    } else {
      mangleOpt = true;
    }
  }

  const result = await minify(code, {
    compress: compressOpt,
    mangle: mangleOpt,
    format: {
      ecma: 5,
      comments: /@meta/,
    },
  });
  if (!result.code) {
    throw new Error("minify pass produced empty output");
  }
  return result.code;
}

/**
 * Source → `{ raw, min }` for one variant, with no disk IO: envPass →
 * log-shorten → intern → minifyPass. `scripts/build-shelly.mjs`'s
 * `buildVariant` adds the writes and the tier-3 step on top;
 * `scripts/bench-minify.mjs` calls this one directly, so the benchmark
 * measures the pipeline that actually ships rather than a reimplementation of
 * it.
 * @param {string} tscJs
 * @param {string} name
 * @param {{ debug: boolean, prod: boolean }} flags
 * @param {typeof import("./minify-options.d.mts").DEFAULT_MINIFY} minifyOpts raw config, not yet scope-resolved
 * @param {{ sharedIds: Map<string, string>, shorten: boolean }} logMapState
 * @param {Record<string, unknown>} deviceDefs meta.device.* global_defs (possibly {})
 */
export async function transformVariant(
  tscJs,
  name,
  flags,
  minifyOpts,
  logMapState,
  deviceDefs,
) {
  const variantOpts = resolveVariantOptions(minifyOpts, name);
  let raw = await envPass(tscJs, flags, deviceDefs, {
    dropConsole: variantOpts.dropConsole === true,
  });
  // Log strings cost RAM on device; the log panel re-expands the ids.
  if (logMapState.shorten) {
    const shortened = shortenLogStrings(raw, logMapState.sharedIds);
    raw = shortened.code;
  }
  // Hoist repeated string literals into top-level vars — after log-shorten
  // (so already-short log ids fall below break-even naturally) and before
  // the Terser pass (which mangles the generated var names for free).
  let interned = { interned: 0, savedBytes: 0 };
  if (variantOpts.internStrings === true) {
    const result = internStrings(raw);
    raw = result.code;
    interned = { interned: result.interned, savedBytes: result.savedBytes };
  }

  const min = await minifyPass(raw, variantOpts);
  return { variantOpts, raw, min, interned };
}
