import { AuthNotSupportedError, RpcError } from "../device/rpc.ts";
import { updateProbeRun, type ProbeRun } from "./probe-run.ts";
import type { Host, ProbeEntry, ProbeRpc } from "./probe.ts";

export const MAX_HOST_RESTARTS = 3;
const HOST_DEAD_CODES = new Set([-109, -105]);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function looksLikeHostDeath(error: unknown): boolean {
  if (error instanceof RpcError && HOST_DEAD_CODES.has(error.code)) return true;
  return /not running|precondition failed/i.test(message(error));
}

/**
 * The connection failed, so the device never rendered a verdict. These must not
 * be filed as ordinary `ok: false` answers: `isAbsent` ignores them, which would
 * leave `probe-absent-api` reporting **pass** over capabilities nothing checked.
 * `send()` tears the socket down on an RPC timeout, so one of these means the
 * rest of the run is doomed too.
 */
function looksLikeTransportFailure(error: unknown): boolean {
  if (error instanceof RpcError) return false;
  return /deadline exceeded|RPC timeout|WebSocket (closed|not connected)|connection failed/i.test(
    message(error),
  );
}

function valueOf(result: unknown): unknown {
  return result && typeof result === "object" && "result" in result
    ? (result as { result: unknown }).result
    : result;
}

async function running(rpc: ProbeRpc, id: number): Promise<boolean> {
  try {
    const status = (await rpc.call("Script.GetStatus", { id })) as { running?: unknown } | null;
    return status?.running === true;
  } catch (error) {
    if (error instanceof AuthNotSupportedError) throw error;
    return false;
  }
}

async function reviveHost(
  rpc: ProbeRpc,
  host: Host,
  createScratch: () => Promise<number>,
): Promise<void> {
  if (host.strategy !== "scratch") {
    await rpc.call("Script.Start", { id: host.scriptId });
    return;
  }
  try {
    await rpc.call("Script.Start", { id: host.scriptId });
  } catch (error) {
    if (!(error instanceof RpcError) || error.code !== -105) throw error;
    const id = await createScratch();
    host.scriptId = id;
    host.scratchScriptId = id;
  }
}

export async function repairUserHost(rpc: ProbeRpc, host: Host): Promise<void> {
  if (host.strategy === "scratch" || !host.repairProbeId) return;
  const label = host.name ? ` ("${host.name}")` : "";
  try {
    await rpc.call("Script.Start", { id: host.scriptId });
    host.notes.push(
      `WARNING: evaluating "${host.repairProbeId}" stopped script ${host.scriptId}${label} — restarted it; check that it recovered`,
    );
    host.repairProbeId = null;
  } catch (error) {
    host.notes.push(
      `WARNING: evaluating "${host.repairProbeId}" stopped script ${host.scriptId}${label} and it could not be restarted (${message(error)}) — start it from the device panel`,
    );
  }
}

export type Evaluation = { entry: ProbeEntry; exhausted: boolean };

export async function evaluateProbe(
  rpc: ProbeRpc,
  host: Host,
  probe: { id: string; code: string },
  restarts: { count: number },
  run: ProbeRun,
  createScratch: () => Promise<number>,
): Promise<Evaluation> {
  try {
    const result = await rpc.call("Script.Eval", { id: host.scriptId, code: probe.code });
    return { entry: { id: probe.id, code: probe.code, ok: true, result: valueOf(result) }, exhausted: false };
  } catch (error) {
    if (error instanceof AuthNotSupportedError) throw error;
    // Before the host-death probe below: `running()` needs the same dead socket.
    if (looksLikeTransportFailure(error)) {
      return {
        entry: {
          id: probe.id,
          code: probe.code,
          ok: false,
          error: message(error),
          unevaluated: "transport",
        },
        exhausted: true,
      };
    }
    if (!looksLikeHostDeath(error) || (await running(rpc, host.scriptId))) {
      return { entry: { id: probe.id, code: probe.code, ok: false, error: message(error) }, exhausted: false };
    }
    host.repairProbeId = probe.id;
    if (restarts.count >= MAX_HOST_RESTARTS) {
      return { entry: { id: probe.id, code: probe.code, ok: false, error: message(error), unevaluated: "host-dead" }, exhausted: true };
    }
    restarts.count += 1;
    updateProbeRun(run, { phase: "reviving-host" });
    try {
      await reviveHost(rpc, host, createScratch);
      host.repairProbeId = null;
      if (host.strategy === "scratch") {
        host.notes.push(`probe host restarted after ${probe.id}`);
      } else {
        const label = host.name ? ` ("${host.name}")` : "";
        host.notes.push(
          `WARNING: evaluating "${probe.id}" stopped script ${host.scriptId}${label} — restarted it; check that it recovered`,
        );
      }
    } catch (restartError) {
      return {
        entry: { id: probe.id, code: probe.code, ok: false, error: message(restartError), unevaluated: "host-dead" },
        exhausted: restarts.count >= MAX_HOST_RESTARTS,
      };
    }
    updateProbeRun(run, { phase: "probing" });
    try {
      const result = await rpc.call("Script.Eval", { id: host.scriptId, code: probe.code });
      return { entry: { id: probe.id, code: probe.code, ok: true, result: valueOf(result) }, exhausted: false };
    } catch (retryError) {
      if (retryError instanceof AuthNotSupportedError) throw retryError;
      if (!(await running(rpc, host.scriptId))) host.repairProbeId = probe.id;
      return {
        entry: { id: probe.id, code: probe.code, ok: false, error: message(retryError), unevaluated: "host-dead" },
        exhausted: restarts.count >= MAX_HOST_RESTARTS,
      };
    }
  }
}
