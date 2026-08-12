/**
 * Hand-written types for minify-options.mjs. TypeScript can't infer a precise
 * per-key object shape from the `Object.fromEntries` construction of
 * DEFAULT_MINIFY, and `server/config.ts`'s `MinifyConfig` must stay a
 * concretely-typed object (not `Record<string, boolean>`) so a typo'd key
 * anywhere in the server/build pipeline is still a compile error.
 */

export type MinifyScope = "both" | "prod" | "debug";

export type MinifyOptionKey =
  | "compress"
  | "mangle"
  | "toplevel"
  | "keepFnames"
  | "logMap"
  | "debugLogMap"
  | "advanced"
  | "dropConsole"
  | "passes"
  | "hoistProps"
  | "deviceDCE"
  | "internStrings";

export type MinifyOptionDef = {
  key: MinifyOptionKey;
  label: string;
  default: boolean;
  scope: MinifyScope;
};

/** Knobs the Shelly build pipeline actually honors today. */
export type MinifyConfig = {
  /** Terser `compress` (defaults when true). */
  compress: boolean;
  /** Terser `mangle` (locals only — never properties). */
  mangle: boolean;
  /** Terser `toplevel` on compress + mangle. */
  toplevel: boolean;
  /** Terser `keep_fnames` on compress + mangle (pairs with toplevel). */
  keepFnames: boolean;
  /** Prod log-string shortening → `dist/prod.logmap.json`. */
  logMap: boolean;
  /** Also shorten log strings on the debug artifact (default off). */
  debugLogMap: boolean;
  /** Tier-3 `espruino --minify` → `*.adv.js`. */
  advanced: boolean;
  /** Terser `compress.drop_console` — prod-only, never applied to debug. */
  dropConsole: boolean;
  /** Terser `compress.passes: 3` (default is a single pass). */
  passes: boolean;
  /** Terser `compress.hoist_props: true`. */
  hoistProps: boolean;
  /**
   * Extend `meta.env.*` DCE with `meta.device.gen` / `meta.device.model` /
   * `meta.device.fw`, sourced from `types/device-profile.json`. A missing or
   * partial profile substitutes nothing (never `undefined`) and the artifact
   * becomes device-specific.
   */
  deviceDCE: boolean;
  /**
   * Hoist repeated string literals into top-level `var`s (pre-Terser). Only
   * applied when the net byte cost of the declaration is actually negative —
   * Terser does not do this on its own, and it pays off on scripts with
   * repeated RPC method-name strings.
   */
  internStrings: boolean;
};

export const MINIFY_OPTIONS: MinifyOptionDef[];
export const MINIFY_KEYS: MinifyOptionKey[];
export const DEFAULT_MINIFY: MinifyConfig;
