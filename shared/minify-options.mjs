/**
 * Single source of truth for the Terser/log-map/tier-3 minify option schema.
 * Consumed directly by scripts/build-shelly.mjs (build pipeline) and
 * server/core/config.ts (shellint.json parse/PATCH), and bundled into web UI
 * (web/shell/options-panel.tsx) via esbuild. Types for TS consumers live in the
 * hand-written sibling `minify-options.d.ts` — see it for why.
 *
 * `scope` says which build variant(s) the option actually affects:
 *   - "both"  — applies to the debug and prod artifact alike (Terser knobs)
 *   - "prod"  — only the prod build reads it (prod log-string shortening)
 *   - "debug" — only the debug build reads it (debug log-string shortening)
 * Runtime behavior does not yet branch on `scope` (P6); it exists now so a
 * future grouped panel doesn't need a second schema pass.
 */

/** @type {import("./minify-options.d.mts").MinifyOptionDef[]} */
export const MINIFY_OPTIONS = [
  { key: "compress", label: "compress", default: true, scope: "both" },
  { key: "mangle", label: "mangle", default: true, scope: "both" },
  { key: "toplevel", label: "toplevel", default: false, scope: "both" },
  { key: "keepFnames", label: "keep fnames", default: false, scope: "both" },
  { key: "logMap", label: "prod log map", default: true, scope: "prod" },
  {
    key: "debugLogMap",
    label: "debug log map",
    default: false,
    scope: "debug",
  },
  { key: "advanced", label: "advanced minify", default: true, scope: "both" },
  {
    key: "dropConsole",
    label: "drop console",
    default: false,
    scope: "prod",
  },
  { key: "passes", label: "3 compress passes", default: false, scope: "both" },
  {
    key: "hoistProps",
    label: "hoist props",
    default: false,
    scope: "both",
  },
  { key: "deviceDCE", label: "device DCE", default: false, scope: "both" },
  {
    key: "internStrings",
    label: "intern strings",
    default: false,
    scope: "both",
  },
];

/** @type {import("./minify-options.d.mts").MinifyOptionKey[]} */
export const MINIFY_KEYS = MINIFY_OPTIONS.map((o) => o.key);

/** @type {import("./minify-options.d.mts").MinifyConfig} */
export const DEFAULT_MINIFY = Object.fromEntries(
  MINIFY_OPTIONS.map((o) => [o.key, o.default]),
);
