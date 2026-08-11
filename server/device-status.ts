import { loadConfig, assertDevroomCompiler } from "./config.ts";
import { AuthNotSupportedError, ShellyRpc } from "./rpc.ts";

export type DeviceStatus = {
  deviceIp: string;
  scriptId: number;
  latencyMs: number;
  device: {
    id?: string;
    model?: string;
    gen?: number | string;
    ver?: string;
    app?: string;
    chip: string;
    chipInferred: true;
  };
  script: {
    id: number;
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
  wifi: {
    rssi: number | null;
    ssid: string | null;
    sta_ip: string | null;
  };
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
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

export async function fetchDeviceStatus(): Promise<DeviceStatus> {
  const cfg = loadConfig();
  assertDevroomCompiler(cfg);

  const rpc = new ShellyRpc(cfg.deviceIp);
  const rtts: number[] = [];

  try {
    await rpc.connect();

    const infoCall = await softCall(rpc, "Shelly.GetDeviceInfo", {});
    if (infoCall) rtts.push(infoCall.ms);
    const info = (infoCall?.result ?? {}) as Record<string, unknown>;

    const scriptCall = await timedCall(rpc, "Script.GetStatus", {
      id: cfg.scriptId,
    });
    rtts.push(scriptCall.ms);
    const script = (scriptCall.result ?? {}) as Record<string, unknown>;

    const sysCall = await timedCall(rpc, "Sys.GetStatus", {});
    rtts.push(sysCall.ms);
    const sys = (sysCall.result ?? {}) as Record<string, unknown>;

    const cfgCall = await softCall(rpc, "Sys.GetConfig", {});
    if (cfgCall) rtts.push(cfgCall.ms);
    const sysCfg = (cfgCall?.result ?? {}) as Record<string, unknown>;
    const deviceCfg = (sysCfg.device ?? {}) as Record<string, unknown>;

    const wifiCall = await softCall(rpc, "WiFi.GetStatus", {});
    if (wifiCall) rtts.push(wifiCall.ms);
    const wifi = (wifiCall?.result ?? {}) as Record<string, unknown>;
    const sta = (wifi.sta_ip != null ? wifi : (wifi.sta ?? wifi)) as Record<
      string,
      unknown
    >;

    let temperatureC: number | null = null;
    const tempCall = await softCall(rpc, "Temperature.GetStatus", { id: 0 });
    if (tempCall) {
      rtts.push(tempCall.ms);
      const t = tempCall.result as Record<string, unknown>;
      temperatureC = num(t.tC);
    }

    const latencyMs =
      rtts.length > 0
        ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length)
        : 0;

    return {
      deviceIp: cfg.deviceIp,
      scriptId: cfg.scriptId,
      latencyMs,
      device: {
        id: str(info.id) ?? undefined,
        model: str(info.model) ?? undefined,
        gen: (info.gen as number | string | undefined) ?? undefined,
        ver: str(info.ver) ?? undefined,
        app: str(info.app) ?? undefined,
        chip: inferChip(info.gen, info.model),
        chipInferred: true,
      },
      script: {
        id: cfg.scriptId,
        running: bool(script.running),
        mem_used: num(script.mem_used),
        mem_peak: num(script.mem_peak),
        mem_free: num(script.mem_free),
        cpu: num(script.cpu),
        errors: Array.isArray(script.errors) ? script.errors : [],
      },
      sys: {
        ram_size: num(sys.ram_size),
        ram_free: num(sys.ram_free),
        ram_min_free: num(sys.ram_min_free),
        fs_size: num(sys.fs_size),
        fs_free: num(sys.fs_free),
        uptime: num(sys.uptime),
        restart_required: bool(sys.restart_required),
        unixtime: num(sys.unixtime),
      },
      eco_mode: bool(deviceCfg.eco_mode),
      temperatureC,
      wifi: {
        rssi: num(wifi.rssi) ?? num(sta.rssi),
        ssid: str(wifi.ssid) ?? str(sta.ssid),
        sta_ip: str(wifi.sta_ip) ?? str(sta.ip) ?? str(sta.sta_ip),
      },
    };
  } finally {
    rpc.close();
  }
}

export type EcoResult = {
  eco_mode: boolean;
  restart_required: boolean | null;
};

export async function setEcoMode(eco_mode: boolean): Promise<EcoResult> {
  const cfg = loadConfig();
  assertDevroomCompiler(cfg);

  const rpc = new ShellyRpc(cfg.deviceIp);
  try {
    await rpc.connect();
    const result = (await rpc.call("Sys.SetConfig", {
      config: { device: { eco_mode } },
    })) as Record<string, unknown>;

    const read = await softCall(rpc, "Sys.GetConfig", {});
    const sysCfg = (read?.result ?? {}) as Record<string, unknown>;
    const deviceCfg = (sysCfg.device ?? {}) as Record<string, unknown>;
    const confirmed = bool(deviceCfg.eco_mode);

    return {
      eco_mode: confirmed ?? eco_mode,
      restart_required: bool(result.restart_required),
    };
  } finally {
    rpc.close();
  }
}

export { AuthNotSupportedError };
