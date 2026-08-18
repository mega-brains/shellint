import { runtime } from "#shellint/runtime";
import { DIST_DIR } from "../core/paths.ts";
import { loadConfig, assertShellintCompiler } from "../core/config.ts";
import { bindSlot, getDevice, requireActive } from "./devices.ts";
import { probeState, type ProbeState } from "../probe/probe-store.ts";
import { createSlot } from "./device-scripts.ts";
import {
  AuthNotSupportedError,
  AuthFailedError,
  ShellyRpc,
  RpcError,
  type RpcTarget,
} from "./rpc.ts";

const { fs } = runtime;
const { join } = runtime.path;

/** Thrown before the RPC connects — deploy is the one place the probe-required
 * gate is enforced server-side (M16 §2.3), so a CLI deploy cannot bypass what
 * the UI insists on. */
export class ProbeRequiredError extends Error {
  deviceId: string;
  ver: string | null;
  reason: ProbeState["reason"];
  constructor(deviceId: string, label: string, ver: string | null, reason: ProbeState["reason"]) {
    super(`run Probe (or Skip) for ${label} fw ${ver ?? "unknown"} first`);
    this.name = "ProbeRequiredError";
    this.deviceId = deviceId;
    this.ver = ver;
    this.reason = reason;
  }
}

/** Minimal RPC surface `deploy` needs — lets tests supply a fake device. */
export type DeployRpc = {
  connect(): Promise<void>;
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
};
export type DeployRpcFactory = (target: RpcTarget) => DeployRpc;

const CHUNK_SIZE = 1024;

export type DeployMode = "debug" | "prod";
export type DeployMinify = "min" | "raw";

export type DeployOptions = {
  /** Defaults to the active device. */
  deviceId?: string;
  /** Defaults to the active slot; ignored (the new slot wins) when `createName` is set. */
  slot?: number;
  /** Per-script workspaces (M16) — only "main" exists today. */
  scriptKey?: string;
  /** Set ⇒ `Script.Create` first, deploy into the new slot, and bind it in devices.json. */
  createName?: string;
  /** `mise run deploy -- --no-probe-check` — bypasses the probe-required gate. */
  skipProbeCheck?: boolean;
  /** Test-only — production always uses the real `ShellyRpc`. */
  rpcFactory?: DeployRpcFactory;
};

export type DeployResult = {
  mode: DeployMode;
  minify: DeployMinify;
  artifact: string;
  scriptId: number;
  localBytes: number;
  deviceLen: number | null;
  status: "running";
};

export type DeployProgress = (msg: string) => void;

function artifactPath(mode: DeployMode, minify: DeployMinify): string {
  return minify === "raw"
    ? join(DIST_DIR, `${mode}.raw.js`)
    : join(DIST_DIR, `${mode}.js`);
}

/**
 * ALLTERCO put_script.py pattern over WS:
 * stop → PutCode 1024-byte chunks (append after first) → start.
 * Overwrites the target scriptId — never `Script.Create`, unless `opts.createName`
 * asks for a brand new slot.
 */
export async function deploy(
  mode: DeployMode,
  onProgress: DeployProgress = () => {},
  minify: DeployMinify = "min",
  opts: DeployOptions = {},
): Promise<DeployResult> {
  const cfg = await loadConfig();
  assertShellintCompiler(cfg);

  if (mode !== "debug" && mode !== "prod") {
    throw new Error(`invalid mode "${mode}" — use "debug" or "prod"`);
  }
  if (minify !== "min" && minify !== "raw") {
    throw new Error(`invalid minify "${minify}" — use "min" or "raw"`);
  }
  if (opts.scriptKey && opts.scriptKey !== "main") {
    throw new Error(
      `per-script workspaces are not implemented yet (M16) — only "main" exists`,
    );
  }

  const path = artifactPath(mode, minify);
  if (!(await fs.exists(path))) {
    throw new Error(`missing build artifact ${path} — run Build first`);
  }

  const code = await fs.readText(path);
  const localBytes = runtime.byteLength(code);
  const active = await requireActive();
  const device = opts.deviceId
    ? ((await getDevice(opts.deviceId)) ?? active.device)
    : active.device;

  if (opts.skipProbeCheck !== true) {
    const state = await probeState(device.id);
    if (state.required) {
      throw new ProbeRequiredError(device.id, device.label, state.ver, state.reason);
    }
  }

  const rpcFactory: DeployRpcFactory = opts.rpcFactory ?? ((t) => new ShellyRpc(t));
  const rpc = rpcFactory({ ip: device.ip, auth: device.auth });
  try {
    onProgress("connecting");
    await rpc.connect();

    let scriptId = opts.createName ? undefined : (opts.slot ?? active.slot);
    if (opts.createName) {
      onProgress("creating slot");
      scriptId = await createSlot(rpc, opts.createName);
      await bindSlot(device.id, scriptId, opts.scriptKey ?? "main", opts.createName);
    }
    const targetId = scriptId!;

    onProgress("stopped");
    try {
      await rpc.call("Script.Stop", { id: targetId });
    } catch (e) {
      // Already stopped is fine on some firmwares.
      if (!(e instanceof RpcError)) throw e;
    }

    // Match put_script.py: slice by character count (ASCII JS ≈ bytes).
    onProgress("uploading");
    let deviceLen: number | null = null;
    let append = false;
    let pos = 0;
    while (pos < code.length) {
      const chunk = code.slice(pos, pos + CHUNK_SIZE);
      const result = (await rpc.call("Script.PutCode", {
        id: targetId,
        code: chunk,
        append,
      })) as { len?: number } | null;
      if (result && typeof result.len === "number") {
        deviceLen = result.len;
      }
      pos += chunk.length;
      append = true;
      onProgress(`uploading ${pos}/${code.length}`);
    }

    if (deviceLen != null && deviceLen !== localBytes) {
      onProgress(`warning: device len ${deviceLen} ≠ local ${localBytes}`);
    }

    onProgress("starting");
    await rpc.call("Script.Start", { id: targetId });
    onProgress("running");

    return {
      mode,
      minify,
      artifact: path,
      scriptId: targetId,
      localBytes,
      deviceLen,
      status: "running",
    };
  } finally {
    rpc.close();
  }
}

export { AuthNotSupportedError, AuthFailedError };
