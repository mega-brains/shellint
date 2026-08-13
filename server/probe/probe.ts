import { loadConfig, assertDevroomCompiler } from "../core/config.ts";
import {
  clearProbeSkip,
  mirrorActiveDevice,
  requireActive,
  toDeviceInfo,
  touchDeviceInfo,
} from "../device/devices.ts";
import { createSlot, deleteSlot } from "../device/device-scripts.ts";
import { applyEcoMode, readEcoConfig } from "../device/device-status.ts";
import { AuthNotSupportedError, ShellyRpc } from "../device/rpc.ts";
// Script.Eval expressions, and they must stay side-effect-free: they may be
// evaluated inside a script the user owns.
import { PROBES } from "./probe-catalog.ts";
import { writeCapture } from "./probe-store.ts";

/** Live progress of the in-flight (or most recent) probe run, polled by the UI. */
let progressState = { done: 0, total: 0 };

export function getProbeProgress(): { done: number; total: number } {
  return { ...progressState };
}

/** Temporary slot created by the probe. Only ever a freshly created id. */
const SCRATCH_NAME = "devroom-probe";
/** A registered handler guarantees the slot stays `running` while we evaluate. */
const SCRATCH_CODE = "Shelly.addStatusHandler(function () {});\n";

/** Which slot the probes ran in, and how it was obtained. */
export type ProbeStrategy = "configured" | "scratch" | "running-slot";

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
  /**
   * Provenance (M16 §3.2) — stamped from `Shelly.GetDeviceInfo`, fetched once
   * up front since `runProbe` already holds the connection. Optional on read:
   * the committed `types/generated-probe.json` fixture predates these fields.
   */
  deviceId?: string;
  ver?: string | null;
  model?: string | null;
  gen?: number | null;
  /** Slot the probes actually ran in. */
  scriptId: number;
  configuredScriptId: number;
  strategy: ProbeStrategy;
  /** Slots present before the probe — none of these are written to or deleted. */
  existingScriptIds: number[];
  scratchScriptId: number | null;
  scratchRemoved: boolean;
  notes: string[];
  results: ProbeEntry[];
};

type Slot = { id: number; name: string | null; running: boolean | null };

/** Minimal RPC surface the slot handling needs — lets tests supply a fake device. */
export type ProbeRpc = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
};

export type Host = {
  scriptId: number;
  strategy: ProbeStrategy;
  scratchScriptId: number | null;
  existingScriptIds: number[];
  notes: string[];
};

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toSlot(v: unknown): Slot | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "number") return null;
  return {
    id: o.id,
    name: typeof o.name === "string" ? o.name : null,
    running: typeof o.running === "boolean" ? o.running : null,
  };
}

async function listSlots(rpc: ProbeRpc): Promise<Slot[]> {
  const res = (await rpc.call("Script.List", {})) as { scripts?: unknown } | null;
  const arr = Array.isArray(res?.scripts) ? res.scripts : [];
  return arr.map(toSlot).filter((s): s is Slot => s !== null);
}

async function isRunning(rpc: ProbeRpc, id: number): Promise<boolean> {
  try {
    const st = (await rpc.call("Script.GetStatus", { id })) as {
      running?: unknown;
    } | null;
    return st?.running === true;
  } catch (e) {
    if (e instanceof AuthNotSupportedError) throw e;
    return false;
  }
}

/**
 * Script.Create (via device-scripts.ts, the same helper the slot routes use)
 * a fresh slot, upload the keep-alive stub, start it. Refuses to write to any
 * id that already existed; cleans up on partial failure.
 */
async function createScratchHost(
  rpc: ProbeRpc,
  existingIds: Set<number>,
): Promise<number> {
  const id = await createSlot(rpc, SCRATCH_NAME);
  if (existingIds.has(id)) {
    throw new Error(
      `Script.Create returned pre-existing slot ${id} — refusing to overwrite a stored script`,
    );
  }

  try {
    await rpc.call("Script.PutCode", { id, code: SCRATCH_CODE, append: false });
    await rpc.call("Script.Start", { id });
    return id;
  } catch (e) {
    await removeScratch(rpc, id).catch(() => {});
    throw e;
  }
}

export async function removeScratch(rpc: ProbeRpc, id: number): Promise<void> {
  await deleteSlot(rpc, id);
}

/**
 * Find a slot to evaluate in without modifying anything the user stored:
 * configured slot if it is already running → fresh temporary slot →
 * read-only eval inside some other already-running script.
 */
export async function acquireHost(
  rpc: ProbeRpc,
  configuredId: number,
): Promise<Host> {
  const notes: string[] = [];
  const slots = await listSlots(rpc);
  const existingIds = new Set(slots.map((s) => s.id));
  const existingScriptIds = [...existingIds].sort((a, b) => a - b);

  if (existingIds.has(configuredId) && (await isRunning(rpc, configuredId))) {
    return {
      scriptId: configuredId,
      strategy: "configured",
      scratchScriptId: null,
      existingScriptIds,
      notes,
    };
  }

  const stale = slots.filter((s) => s.name === SCRATCH_NAME).map((s) => s.id);
  if (stale.length > 0) {
    notes.push(
      `leftover "${SCRATCH_NAME}" slot(s) ${stale.join(", ")} on device — left untouched, delete manually if unwanted`,
    );
  }

  try {
    const id = await createScratchHost(rpc, existingIds);
    notes.push(
      `script ${configuredId} not running — probed in temporary slot ${id} ("${SCRATCH_NAME}"), removed afterwards`,
    );
    return {
      scriptId: id,
      strategy: "scratch",
      scratchScriptId: id,
      existingScriptIds,
      notes,
    };
  } catch (e) {
    if (e instanceof AuthNotSupportedError) throw e;
    notes.push(`temporary slot unavailable (${msg(e)})`);
  }

  for (const s of slots) {
    if (s.id === configuredId || s.running === false) continue;
    if (await isRunning(rpc, s.id)) {
      notes.push(
        `probed read-only inside running script ${s.id}${s.name ? ` ("${s.name}")` : ""} — its code was not modified`,
      );
      return {
        scriptId: s.id,
        strategy: "running-slot",
        scratchScriptId: null,
        existingScriptIds,
        notes,
      };
    }
  }

  throw new Error(
    `no script is running and a temporary probe slot could not be created` +
      ` (${notes.join("; ")}) — start a script (Deploy) and probe again`,
  );
}

/** What to do about eco mode for this run, as chosen in the UI's confirmation
 * dialog. Omitted leaves eco exactly as it is. */
export type EcoOverride = "probe-only" | "permanent";
export type RunProbeOptions = { ecoOff?: EcoOverride };

/**
 * Eco mode buys power at the cost of "reduced execution speed and increased
 * network latency" (Sys docs) — which a probe pays for `PROBES.length` times
 * over, sequentially. Turning it off is the caller's explicit choice, never
 * implicit: it is a persisted device config change, and on some firmwares it
 * only takes effect after a restart (surfaced as a note rather than acted on —
 * rebooting mid-probe would drop the connection this run needs).
 *
 * Returns whether the caller must switch eco back on when the run ends.
 */
export async function disableEcoForProbe(
  rpc: ProbeRpc,
  mode: EcoOverride | undefined,
  notes: string[],
): Promise<boolean> {
  if (!mode) return false;
  if ((await readEcoConfig(rpc)) !== true) return false;

  const result = await applyEcoMode(rpc, false);
  notes.push(
    mode === "permanent"
      ? "eco mode turned off (left off after the probe, as requested)"
      : "eco mode turned off for this run — restored afterwards",
  );
  if (result.restart_required) {
    notes.push(
      "WARNING: device reports a restart is required for the eco-mode change to take effect — this run may still be slow",
    );
  }
  return mode === "probe-only";
}

/**
 * Run Script.Eval capability checks and write types/generated-probe.json.
 * Never writes to or deletes a script slot that already existed on the device:
 * it evaluates in the configured slot when that is already running, otherwise in a
 * temporary slot it creates and removes, otherwise read-only in another running script.
 */
export async function runProbe(opts: RunProbeOptions = {}): Promise<ProbeReport> {
  const cfg = loadConfig();
  assertDevroomCompiler(cfg);
  const target = requireActive();

  const rpc = new ShellyRpc({ ip: target.device.ip, auth: target.device.auth });
  const results: ProbeEntry[] = [];
  const ecoNotes: string[] = [];
  let scratchRemoved = false;
  let restoreEco = false;
  progressState = { done: 0, total: PROBES.length };

  try {
    await rpc.connect();
    const info = ((await rpc.call("Shelly.GetDeviceInfo", {})) ?? {}) as Record<
      string,
      unknown
    >;
    // The report's `deviceId` must match the `.devroom/devices.json` key it is
    // filed under (not necessarily `info.id`) — a device added while offline
    // keeps its fallback slug id even after it later answers with its own,
    // and every downstream match (mirrorActiveDevice, lintProbe) compares
    // against the devices.json id.
    const deviceId = target.device.id;
    const ver = typeof info.ver === "string" ? info.ver : null;
    const model = typeof info.model === "string" ? info.model : null;
    const gen = typeof info.gen === "number" ? info.gen : null;
    touchDeviceInfo(deviceId, toDeviceInfo(info));
    // Before `acquireHost`: slot creation and the keep-alive stub are round
    // trips that pay the eco penalty too.
    restoreEco = await disableEcoForProbe(rpc, opts.ecoOff, ecoNotes);
    const host = await acquireHost(rpc, target.slot);

    try {
      for (const p of PROBES) {
        try {
          const result = await rpc.call("Script.Eval", {
            id: host.scriptId,
            code: p.code,
          });
          const value =
            result && typeof result === "object" && "result" in (result as object)
              ? (result as { result: unknown }).result
              : result;
          results.push({ id: p.id, code: p.code, ok: true, result: value });
        } catch (e) {
          if (e instanceof AuthNotSupportedError) throw e;
          results.push({ id: p.id, code: p.code, ok: false, error: msg(e) });
        }
        progressState.done += 1;
      }
    } finally {
      if (host.scratchScriptId != null) {
        try {
          await removeScratch(rpc, host.scratchScriptId);
          scratchRemoved = true;
        } catch (e) {
          host.notes.push(
            `WARNING: temporary slot ${host.scratchScriptId} could not be removed (${msg(e)}) — delete it on the device`,
          );
        }
      }
      if (restoreEco) {
        try {
          await applyEcoMode(rpc, true);
          restoreEco = false;
          ecoNotes.push("eco mode restored");
        } catch (e) {
          ecoNotes.push(
            `WARNING: eco mode could not be restored (${msg(e)}) — turn it back on in the device panel`,
          );
          restoreEco = false;
        }
      }
    }

    const report: ProbeReport = {
      probed: true,
      at: new Date().toISOString(),
      deviceIp: target.device.ip,
      deviceId,
      ver,
      model,
      gen,
      scriptId: host.scriptId,
      configuredScriptId: target.slot,
      strategy: host.strategy,
      existingScriptIds: host.existingScriptIds,
      scratchScriptId: host.scratchScriptId,
      scratchRemoved,
      notes: [...ecoNotes, ...host.notes],
      results,
    };

    writeCapture(target.device.id, report);
    clearProbeSkip(target.device.id, ver);
    mirrorActiveDevice(target.device.id);
    return report;
  } finally {
    // Only reached when the run failed before the inner `finally` could
    // restore it — a thrown probe must not leave eco off behind it.
    if (restoreEco) await applyEcoMode(rpc, true).catch(() => {});
    rpc.close();
  }
}

export { AuthNotSupportedError };
