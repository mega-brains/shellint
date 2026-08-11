import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PROBE_PATH } from "./paths.ts";
import { loadConfig, assertDevroomCompiler } from "./config.ts";
import { AuthNotSupportedError, ShellyRpc } from "./rpc.ts";

/** Fixed capability probes — Script.Eval expressions. */
const PROBES: { id: string; code: string }[] = [
  { id: "array.map", code: 'typeof [].map' },
  { id: "string.padStart", code: 'typeof "".padStart' },
  { id: "print", code: "typeof print" },
  { id: "setTimeout", code: "typeof setTimeout" },
  { id: "Timer", code: "typeof Timer" },
];

export type ProbeEntry = {
  id: string;
  code: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type ProbeReport = {
  probed: true;
  at: string;
  deviceIp: string;
  scriptId: number;
  results: ProbeEntry[];
};

/**
 * Run Script.Eval capability checks against the configured script slot.
 * Script must already be running on the device.
 * Writes types/generated-probe.json.
 */
export async function runProbe(): Promise<ProbeReport> {
  const cfg = loadConfig();
  assertDevroomCompiler(cfg);

  const rpc = new ShellyRpc(cfg.deviceIp);
  const results: ProbeEntry[] = [];

  try {
    await rpc.connect();

    for (const p of PROBES) {
      try {
        const result = await rpc.call("Script.Eval", {
          id: cfg.scriptId,
          code: p.code,
        });
        const value =
          result && typeof result === "object" && "result" in (result as object)
            ? (result as { result: unknown }).result
            : result;
        results.push({ id: p.id, code: p.code, ok: true, result: value });
      } catch (e) {
        if (e instanceof AuthNotSupportedError) throw e;
        results.push({
          id: p.id,
          code: p.code,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    rpc.close();
  }

  const report: ProbeReport = {
    probed: true,
    at: new Date().toISOString(),
    deviceIp: cfg.deviceIp,
    scriptId: cfg.scriptId,
    results,
  };

  mkdirSync(dirname(PROBE_PATH), { recursive: true });
  writeFileSync(PROBE_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  return report;
}

export { AuthNotSupportedError };
