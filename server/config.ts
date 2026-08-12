import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./paths.ts";

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
};

export type DevroomConfig = {
  deviceIp: string;
  scriptId: number;
  host: string;
  port: number;
  compiler: string;
  minify: MinifyConfig;
};

export const DEFAULT_MINIFY: MinifyConfig = {
  compress: true,
  mangle: true,
  toplevel: false,
  keepFnames: false,
  logMap: true,
  debugLogMap: false,
  advanced: true,
};

const DEFAULTS: DevroomConfig = {
  deviceIp: "192.168.1.100",
  scriptId: 1,
  host: "0.0.0.0",
  port: 8787,
  compiler: "devroom",
  minify: { ...DEFAULT_MINIFY },
};

const MINIFY_KEYS = [
  "compress",
  "mangle",
  "toplevel",
  "keepFnames",
  "logMap",
  "debugLogMap",
  "advanced",
] as const;

function parseMinify(raw: unknown): MinifyConfig {
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const out: MinifyConfig = { ...DEFAULT_MINIFY };
  for (const key of MINIFY_KEYS) {
    if (typeof src[key] === "boolean") out[key] = src[key];
  }
  return out;
}

export function loadConfig(): DevroomConfig {
  const path = join(ROOT, "devroom.json");
  if (!existsSync(path)) {
    return {
      ...DEFAULTS,
      minify: { ...DEFAULT_MINIFY },
    };
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DevroomConfig> &
    Record<string, unknown>;
  return {
    deviceIp: typeof raw.deviceIp === "string" ? raw.deviceIp : DEFAULTS.deviceIp,
    scriptId: typeof raw.scriptId === "number" ? raw.scriptId : DEFAULTS.scriptId,
    host: typeof raw.host === "string" ? raw.host : DEFAULTS.host,
    port: typeof raw.port === "number" ? raw.port : DEFAULTS.port,
    compiler: typeof raw.compiler === "string" ? raw.compiler : DEFAULTS.compiler,
    minify: parseMinify(raw.minify),
  };
}

/** Public config for GET /api/config — no secrets (none stored yet). */
export function sanitizeConfig(cfg: DevroomConfig) {
  return {
    deviceIp: cfg.deviceIp,
    scriptId: cfg.scriptId,
    host: cfg.host,
    port: cfg.port,
    compiler: cfg.compiler,
    minify: { ...cfg.minify },
  };
}

/**
 * Merge a partial `minify` patch into `devroom.json`, preserving unknown keys
 * (e.g. `deviceIp2`). Only minify booleans are writable via the API.
 */
export function patchMinifyConfig(
  patch: Partial<MinifyConfig>,
): DevroomConfig {
  const path = join(ROOT, "devroom.json");
  const raw: Record<string, unknown> = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>)
    : {};

  const current = parseMinify(raw.minify);
  const next: MinifyConfig = { ...current };
  for (const key of MINIFY_KEYS) {
    if (typeof patch[key] === "boolean") next[key] = patch[key]!;
  }
  raw.minify = next;
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return loadConfig();
}

export function assertDevroomCompiler(cfg: DevroomConfig): void {
  if (cfg.compiler !== "devroom") {
    throw new CompilerNotWiredError(cfg.compiler);
  }
}

export class CompilerNotWiredError extends Error {
  constructor(compiler: string) {
    super(
      `compiler "${compiler}" is not wired yet — only "devroom" (clean-room tsc+Terser) is supported. shelly-forge path not wired yet.`,
    );
    this.name = "CompilerNotWiredError";
  }
}
