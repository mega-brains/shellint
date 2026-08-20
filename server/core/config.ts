import { runtime } from "#shellint/runtime";
import { LEGACY_CONFIG_JSON, SHELLINT_JSON } from "./paths.ts";
import {
  DEFAULT_MINIFY,
  MINIFY_KEYS,
  type MinifyConfig,
} from "../../shared/minify-options.mjs";

export type { MinifyConfig };
export { DEFAULT_MINIFY };

export type ShellintConfig = {
  host: string;
  port: number;
  compiler: string;
  minify: MinifyConfig;
};

/**
 * Loopback by default: this API deploys code to hardware, reboots it, reads
 * device script source and stores device passwords in plaintext, with no login
 * of its own — so LAN-wide exposure has to be a deliberate `"host": "0.0.0.0"`
 * in shellint.json, not what a fresh checkout does.
 */
const DEFAULTS: ShellintConfig = {
  host: "127.0.0.1",
  port: 8787,
  compiler: "shellint",
  minify: { ...DEFAULT_MINIFY },
};

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

/**
 * `SHELLINT_PORT` wins over shellint.json, so a second instance (the txiki
 * single-file executable under e2e, e2e/playwright.txiki.config.ts) can run
 * beside a dev server without editing a committed file.
 */
function envPort(): number | null {
  const raw = runtime.process.env.SHELLINT_PORT?.trim();
  if (!raw) return null;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : null;
}

let legacyNoticePrinted = false;
let malformedNoticePrinted = false;

/** Prefer shellint.json; retain devroom.json only for one-time migration. */
export async function resolveConfigPath(): Promise<string | null> {
  if (await runtime.fs.exists(SHELLINT_JSON)) return SHELLINT_JSON;
  if (!(await runtime.fs.exists(LEGACY_CONFIG_JSON))) return null;
  if (!legacyNoticePrinted) {
    legacyNoticePrinted = true;
    console.warn("shellint: using legacy devroom.json; rename it to shellint.json");
  }
  return LEGACY_CONFIG_JSON;
}

function defaultConfig(override: number | null): ShellintConfig {
  return {
    ...DEFAULTS,
    ...(override == null ? {} : { port: override }),
    minify: { ...DEFAULT_MINIFY },
  };
}

export async function loadConfig(): Promise<ShellintConfig> {
  const path = await resolveConfigPath();
  const override = envPort();
  if (!path) return defaultConfig(override);
  let raw: Partial<ShellintConfig> & Record<string, unknown>;
  try {
    raw = JSON.parse(await runtime.fs.readText(path)) as Partial<ShellintConfig> &
      Record<string, unknown>;
  } catch {
    // Every device route calls this, so a five-second status poll must not
    // reprint it once a cycle.
    if (!malformedNoticePrinted) {
      malformedNoticePrinted = true;
      console.warn(`shellint: ${path} is not valid JSON — using defaults`);
    }
    return defaultConfig(override);
  }
  return {
    host: typeof raw.host === "string" ? raw.host : DEFAULTS.host,
    port: override ?? (typeof raw.port === "number" ? raw.port : DEFAULTS.port),
    compiler: typeof raw.compiler === "string" ? raw.compiler : DEFAULTS.compiler,
    minify: parseMinify(raw.minify),
  };
}

/** Public config for GET /api/config — no secrets (none stored yet). */
export function sanitizeConfig(cfg: ShellintConfig) {
  return {
    host: cfg.host,
    port: cfg.port,
    compiler: cfg.compiler,
    minify: { ...cfg.minify },
  };
}

/**
 * Merge a partial `minify` patch into shellint.json. Only minify booleans are
 * writable via the API.
 */
export function patchMinifyConfig(
  patch: Partial<MinifyConfig>,
): Promise<ShellintConfig> {
  return patchMinifyConfigAsync(patch);
}

async function patchMinifyConfigAsync(
  patch: Partial<MinifyConfig>,
): Promise<ShellintConfig> {
  // Read through the legacy fallback but always write shellint.json, so the
  // first minify toggle completes the rename instead of stranding host/port/
  // compiler in a devroom.json that resolveConfigPath will stop consulting.
  const source = await resolveConfigPath();
  const raw: Record<string, unknown> = source
    ? (JSON.parse(await runtime.fs.readText(source)) as Record<string, unknown>)
    : {};

  const current = parseMinify(raw.minify);
  const next: MinifyConfig = { ...current };
  for (const key of MINIFY_KEYS) {
    if (typeof patch[key] === "boolean") next[key] = patch[key]!;
  }
  raw.minify = next;
  await runtime.fs.atomicWriteText(SHELLINT_JSON, `${JSON.stringify(raw, null, 2)}\n`);
  return loadConfig();
}

export function assertShellintCompiler(cfg: ShellintConfig): void {
  if (cfg.compiler !== "shellint" && cfg.compiler !== "devroom") {
    throw new CompilerNotWiredError(cfg.compiler);
  }
}

export class CompilerNotWiredError extends Error {
  constructor(compiler: string) {
    super(
      `compiler "${compiler}" is not wired yet — only "shellint" (clean-room tsc+Terser) is supported. shelly-forge path not wired yet.`,
    );
    this.name = "CompilerNotWiredError";
  }
}
