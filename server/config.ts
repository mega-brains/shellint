import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./paths.ts";

export type DevroomConfig = {
  deviceIp: string;
  scriptId: number;
  host: string;
  port: number;
  compiler: string;
};

const DEFAULTS: DevroomConfig = {
  deviceIp: "192.168.1.100",
  scriptId: 1,
  host: "0.0.0.0",
  port: 8787,
  compiler: "devroom",
};

export function loadConfig(): DevroomConfig {
  const path = join(ROOT, "devroom.json");
  if (!existsSync(path)) {
    return { ...DEFAULTS };
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DevroomConfig>;
  return {
    deviceIp: typeof raw.deviceIp === "string" ? raw.deviceIp : DEFAULTS.deviceIp,
    scriptId: typeof raw.scriptId === "number" ? raw.scriptId : DEFAULTS.scriptId,
    host: typeof raw.host === "string" ? raw.host : DEFAULTS.host,
    port: typeof raw.port === "number" ? raw.port : DEFAULTS.port,
    compiler: typeof raw.compiler === "string" ? raw.compiler : DEFAULTS.compiler,
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
  };
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
