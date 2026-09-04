import { loadConfig, assertShellintCompiler } from "../core/config.ts";
import { readDeviceProfile } from "./device-profile.ts";
import { requireActive, toDeviceInfo, touchDeviceInfo } from "./devices.ts";
import { AuthNotSupportedError, ShellyRpc } from "./rpc.ts";
import { acquireRpc, coalesceRead } from "./rpc-pool.ts";

export type DeviceStatus = {
  deviceIp: string;
  deviceId: string;
  scriptId: number;
  latencyMs: number;
  device: {
    id?: string;
    name?: string;
    model?: string;
    gen?: number | string;
    ver?: string;
    app?: string;
    chip: string;
    chipInferred: true;
  };
  script: {
    id: number;
    name: string | null;
    running: boolean | null;
    mem_used: number | null;
    mem_peak: number | null;
    mem_free: number | null;
    cpu: number | null;
    errors: unknown[];
  };
  sys: {
    ram_size: number | null;
    ram_free: number | null;
    ram_min_free: number | null;
    fs_size: number | null;
    fs_free: number | null;
    uptime: number | null;
    restart_required: boolean | null;
    unixtime: number | null;
  };
  eco_mode: boolean | null;
  temperatureC: number | null;
  /** Which component answered — a relay's own temperature is not a room sensor. */
  temperatureFrom: string | null;
  wifi: {
    rssi: number | null;
    ssid: string | null;
    sta_ip: string | null;
  };
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Component types from the cached profile, so a poll does not spend a failing
 * round trip every five seconds on a component this device does not have.
 * `null` means "no profile yet" — then everything is worth a try.
 */
async function knownComponentTypes(): Promise<Set<string> | null> {
  const profile = await readDeviceProfile();
  if (!profile?.components?.length) return null;
  return new Set(profile.components.map((c) => c.split(":")[0]!.toLowerCase()));
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Community/teardown mapping — not returned by the device. */
export function inferChip(
  gen: unknown,
  model: unknown,
): string {
  const m = typeof model === "string" ? model.toUpperCase() : "";
  // Known exceptions first
  if (/X4|S3SW|S3SN/i.test(m)) return "ESP32-C3";
  const g = typeof gen === "number" ? gen : Number(gen);
  if (g === 4) return "ESP32-C6";
  if (g === 3) return "ESP32-C3";
  if (g === 2) return "ESP32";
  return "unknown";
}

async function timedCall(
  rpc: ShellyRpc,
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ result: unknown; ms: number }> {
  const t0 = performance.now();
  const result = await rpc.call(method, params);
  return { result, ms: Math.round(performance.now() - t0) };
}

type Rec = Record<string, unknown>;

function deviceBlock(info: Rec, deviceCfg: Rec): DeviceStatus["device"] {
  return {
    id: str(info.id) ?? undefined,
    name: str(info.name) ?? str(deviceCfg.name) ?? undefined,
    model: str(info.model) ?? undefined,
    gen: (info.gen as number | string | undefined) ?? undefined,
    ver: str(info.ver) ?? undefined,
    app: str(info.app) ?? undefined,
    chip: inferChip(info.gen, info.model),
    chipInferred: true,
  };
}

function scriptBlock(
  id: number,
  script: Rec,
  slot: Rec | undefined,
): DeviceStatus["script"] {
  return {
    id,
    name: slot ? str(slot.name) : null,
    running: bool(script.running),
    mem_used: num(script.mem_used),
    mem_peak: num(script.mem_peak),
    mem_free: num(script.mem_free),
    cpu: num(script.cpu),
    errors: Array.isArray(script.errors) ? script.errors : [],
  };
}

function sysBlock(sys: Rec): DeviceStatus["sys"] {
  return {
    ram_size: num(sys.ram_size),
    ram_free: num(sys.ram_free),
    ram_min_free: num(sys.ram_min_free),
    fs_size: num(sys.fs_size),
    fs_free: num(sys.fs_free),
    uptime: num(sys.uptime),
    restart_required: bool(sys.restart_required),
    unixtime: num(sys.unixtime),
  };
}

function wifiBlock(wifi: Rec, sta: Rec): DeviceStatus["wifi"] {
  return {
    rssi: num(wifi.rssi) ?? num(sta.rssi),
    ssid: str(wifi.ssid) ?? str(sta.ssid),
    sta_ip: str(wifi.sta_ip) ?? str(sta.ip) ?? str(sta.sta_ip),
  };
}

/**
 * A dedicated sensor is the real reading; a relay's own die temperature is the
 * fallback, because most Gen2 boxes report only that. First non-null wins.
 */
const TEMP_SOURCES = [
  {
    component: "temperature",
    method: "Temperature.GetStatus",
    from: "temperature:0",
    read: (r: Rec) => num(r.tC),
  },
  {
    component: "switch",
    method: "Switch.GetStatus",
    from: "switch:0",
    read: (r: Rec) => num(((r.temperature ?? {}) as Rec).tC),
  },
];

async function softCall(
  rpc: ShellyRpc,
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ result: unknown; ms: number } | null> {
  try {
    return await timedCall(rpc, method, params);
  } catch (e) {
    if (e instanceof AuthNotSupportedError) throw e;
    return null;
  }
}

/** Call, record its round trip, hand back the result — `null` if it failed. */
async function softRec(
  rpc: ShellyRpc,
  rtts: number[],
  method: string,
  params: Rec = {},
): Promise<Rec | null> {
  const call = await softCall(rpc, method, params);
  if (!call) return null;
  rtts.push(call.ms);
  return (call.result ?? {}) as Rec;
}

/** Same, for the two calls whose failure must fail the whole poll. */
async function hardRec(
  rpc: ShellyRpc,
  rtts: number[],
  method: string,
  params: Rec = {},
): Promise<Rec> {
  const call = await timedCall(rpc, method, params);
  rtts.push(call.ms);
  return (call.result ?? {}) as Rec;
}

function meanMs(rtts: number[]): number {
  if (rtts.length === 0) return 0;
  return Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length);
}

async function readTemperature(
  rpc: ShellyRpc,
  rtts: number[],
): Promise<{ temperatureC: number | null; temperatureFrom: string | null }> {
  const present = await knownComponentTypes();
  for (const src of TEMP_SOURCES) {
    if (present !== null && !present.has(src.component)) continue;
    const call = await softCall(rpc, src.method, { id: 0 });
    if (!call) continue;
    rtts.push(call.ms);
    const tC = src.read((call.result ?? {}) as Rec);
    if (tC != null) return { temperatureC: tC, temperatureFrom: src.from };
  }
  return { temperatureC: null, temperatureFrom: null };
}

export async function fetchDeviceStatus(): Promise<DeviceStatus> {
  const cfg = await loadConfig();
  assertShellintCompiler(cfg);
  const target = await requireActive();
  return coalesceRead(
    `status:${target.device.id}`,
    "Shelly.GetDeviceInfo",
    () => fetchDeviceStatusInner(target),
  );
}

async function fetchDeviceStatusInner(
  target: Awaited<ReturnType<typeof requireActive>>,
): Promise<DeviceStatus> {
  const scriptId = target.slot;

  const lease = await acquireRpc({ ip: target.device.ip, auth: target.device.auth });
  const rpc = lease.rpc;
  const rtts: number[] = [];

  try {
    const info = await softRec(rpc, rtts, "Shelly.GetDeviceInfo");
    // Only on a successful answer — a failed poll must not blank out good info.
    if (info) await touchDeviceInfo(target.device.id, toDeviceInfo(info));

    const script = await hardRec(rpc, rtts, "Script.GetStatus", {
      id: scriptId,
    });
    const sys = await hardRec(rpc, rtts, "Sys.GetStatus");

    const sysCfg = await softRec(rpc, rtts, "Sys.GetConfig");
    const deviceCfg = (sysCfg?.device ?? {}) as Rec;

    const wifi = (await softRec(rpc, rtts, "WiFi.GetStatus")) ?? {};
    const sta = (wifi.sta_ip != null ? wifi : (wifi.sta ?? wifi)) as Rec;

    // Script.GetStatus carries no name; the slot listing is the only source.
    const list = (await softRec(rpc, rtts, "Script.List")) ?? {};
    const slot = (Array.isArray(list.scripts) ? list.scripts : []).find(
      (s): s is Rec =>
        !!s && typeof s === "object" && (s as { id?: unknown }).id === scriptId,
    );

    const { temperatureC, temperatureFrom } = await readTemperature(rpc, rtts);

    return {
      deviceIp: target.device.ip,
      deviceId: target.device.id,
      scriptId,
      latencyMs: meanMs(rtts),
      device: deviceBlock(info ?? {}, deviceCfg),
      script: scriptBlock(scriptId, script, slot),
      sys: sysBlock(sys),
      eco_mode: bool(deviceCfg.eco_mode),
      temperatureC,
      temperatureFrom,
      wifi: wifiBlock(wifi, sta),
    };
  } finally {
    lease.release();
  }
}

export type EcoResult = {
  eco_mode: boolean;
  restart_required: boolean | null;
};

/** Minimal RPC surface the eco helpers need, so `runProbe` can drive them on
 * the connection it already holds instead of opening a second one. */
export type EcoRpc = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
};

/** Current `device.eco_mode`, or `null` when the device does not answer. */
export async function readEcoConfig(rpc: EcoRpc): Promise<boolean | null> {
  try {
    const sysCfg = ((await rpc.call("Sys.GetConfig", {})) ?? {}) as Record<
      string,
      unknown
    >;
    const deviceCfg = (sysCfg.device ?? {}) as Record<string, unknown>;
    return bool(deviceCfg.eco_mode);
  } catch (e) {
    if (e instanceof AuthNotSupportedError) throw e;
    return null;
  }
}

/** Writes `device.eco_mode` and reads it straight back — the device is the
 * authority on what actually took, and it also reports whether a restart is
 * needed before the change has any effect. */
export async function applyEcoMode(
  rpc: EcoRpc,
  eco_mode: boolean,
): Promise<EcoResult> {
  const result = (await rpc.call("Sys.SetConfig", {
    config: { device: { eco_mode } },
  })) as Record<string, unknown>;
  const confirmed = await readEcoConfig(rpc);
  return {
    eco_mode: confirmed ?? eco_mode,
    restart_required: bool(result.restart_required),
  };
}

/** One `Sys.GetConfig` round trip — the probe-eco prompt asks this before it
 * decides whether to warn, and must not pay for a full status poll. */
export async function fetchEcoMode(): Promise<{ eco_mode: boolean | null }> {
  const cfg = await loadConfig();
  assertShellintCompiler(cfg);
  const target = await requireActive();

  const lease = await acquireRpc({ ip: target.device.ip, auth: target.device.auth });
  const rpc = lease.rpc;
  try {
    return { eco_mode: await readEcoConfig(rpc) };
  } finally {
    lease.release();
  }
}

export async function setEcoMode(eco_mode: boolean): Promise<EcoResult> {
  const cfg = await loadConfig();
  assertShellintCompiler(cfg);
  const target = await requireActive();

  const lease = await acquireRpc({ ip: target.device.ip, auth: target.device.auth });
  const rpc = lease.rpc;
  try {
    return await applyEcoMode(rpc, eco_mode);
  } finally {
    lease.release();
  }
}

export type ScriptRunResult = { running: boolean | null; scriptId: number };

/**
 * Start or stop the configured script slot. The device answers `Script.Start`
 * with `{was_running}`, so the new state is read back rather than assumed —
 * starting a script that immediately throws leaves it stopped.
 */
export async function setScriptRunning(
  running: boolean,
): Promise<ScriptRunResult> {
  const cfg = await loadConfig();
  assertShellintCompiler(cfg);
  const target = await requireActive();
  const scriptId = target.slot;

  const lease = await acquireRpc({ ip: target.device.ip, auth: target.device.auth });
  const rpc = lease.rpc;
  try {
    await rpc.call(running ? "Script.Start" : "Script.Stop", {
      id: scriptId,
    });
    const status = await softCall(rpc, "Script.GetStatus", { id: scriptId });
    const result = (status?.result ?? {}) as Record<string, unknown>;
    return { running: bool(result.running), scriptId };
  } finally {
    lease.release();
  }
}

/**
 * Soft reboot via `Shelly.Reboot` (not factory wipe). Omitting `delay_ms`
 * uses the device default (1000 ms; minimum allowed is 500).
 */
export async function rebootDevice(): Promise<void> {
  const cfg = await loadConfig();
  assertShellintCompiler(cfg);
  const target = await requireActive();

  const lease = await acquireRpc({ ip: target.device.ip, auth: target.device.auth });
  const rpc = lease.rpc;
  try {
    await rpc.call("Shelly.Reboot", {});
  } finally {
    lease.release();
  }
}

export { AuthNotSupportedError };
