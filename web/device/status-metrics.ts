import type { SparkPoint } from "../charts/spark";
import type { MiniBarsOptions } from "../charts/mini-bars";
import {
  fmtBytes,
  fmtPair,
  RSSI_CEIL,
  RSSI_FLOOR,
  tempTitle,
  usedShare,
  WARN_SHARE,
  type DeviceStatus,
} from "./device-format";

export const HISTORY_NAMES = [
  "mem",
  "cpu",
  "ram",
  "fs",
  "latency",
  "temp",
  "rssi",
] as const;
export type HistoryName = (typeof HISTORY_NAMES)[number];

/** One dock tile: the number, its bar, its history and its aggregate line. */
export type Metric = {
  name: string;
  label: string;
  value: string;
  tone: "" | "ok" | "warn" | "danger";
  share: number | null;
  /** Aggregates under the bar — what the number does not say on its own. */
  sub: string;
  points: SparkPoint[];
  options: MiniBarsOptions;
  title?: string;
};

export function sharePct(share: number | null): number | null {
  return share == null ? null : Math.round(share * 100);
}

export function memShareOf(s: DeviceStatus): number | null {
  const used = s.script.mem_used;
  const free = s.script.mem_free;
  if (used == null || free == null) return null;
  return usedShare(free, used + free);
}

export function cpuShareOf(s: DeviceStatus): number | null {
  return s.script.cpu == null ? null : Math.min(1, s.script.cpu / 100);
}

function ramUsed(s: DeviceStatus | null): number | null {
  if (!s || s.sys.ram_free == null || s.sys.ram_size == null) return null;
  return s.sys.ram_size - s.sys.ram_free;
}

function fsUsed(s: DeviceStatus | null): number | null {
  if (!s || s.sys.fs_free == null || s.sys.fs_size == null) return null;
  return s.sys.fs_size - s.sys.fs_free;
}

const PCT: MiniBarsOptions = { unit: "%", domainMin: 0, domainMax: 100 };

type Ctx = {
  s: DeviceStatus | null;
  /** The status again, but only while the last poll succeeded. */
  live: DeviceStatus | null;
  points: Record<HistoryName, SparkPoint[]>;
};

function scriptMetric({ s }: Ctx): Metric {
  const running = s?.script.running;
  return {
    name: "script",
    label: "script",
    value: running == null ? "—" : running ? "running" : "stopped",
    tone: running ? "ok" : running === false ? "warn" : "",
    sub: s?.script.errors.length
      ? `${s.script.errors.length} error(s)`
      : running == null
        ? "no device"
        : "slot " + (s?.scriptId ?? "?"),
    share: running == null ? null : running ? 1 : 0,
    points: [],
    options: PCT,
    title: s?.script.errors.length
      ? `errors: ${JSON.stringify(s.script.errors)}`
      : "Whether the deployed script is running on the device",
  };
}

function memMetric({ s, live, points }: Ctx): Metric {
  const used = fmtBytes(s?.script.mem_used ?? null);
  const peak = fmtBytes(s?.script.mem_peak ?? null);
  const free = fmtBytes(s?.script.mem_free ?? null);
  return {
    name: "mem",
    label: "script mem used / peak",
    value: used,
    tone: "",
    sub: `peak ${peak} · free ${free}`,
    share: live ? memShareOf(live) : null,
    points: points.mem,
    options: PCT,
    title: `used ${used} · peak ${peak} · free ${free}`,
  };
}

function cpuMetric({ s, live, points }: Ctx): Metric {
  return {
    name: "cpu",
    label: "cpu",
    value: s?.script.cpu == null ? "—" : `${s.script.cpu}%`,
    tone: "",
    sub: "script CPU share reported by the device",
    share: live ? cpuShareOf(live) : null,
    points: points.cpu,
    options: PCT,
  };
}

function ramMetric({ s, live, points }: Ctx): Metric {
  return {
    name: "ram",
    label: "ram free / size",
    value: fmtPair(s?.sys.ram_free ?? null, s?.sys.ram_size ?? null),
    tone: "",
    sub: `used ${fmtBytes(ramUsed(s))}`,
    share: live ? usedShare(live.sys.ram_free, live.sys.ram_size) : null,
    points: points.ram,
    options: PCT,
  };
}

function fsMetric({ s, live, points }: Ctx): Metric {
  return {
    name: "fs",
    label: "fs free / size",
    value: fmtPair(s?.sys.fs_free ?? null, s?.sys.fs_size ?? null),
    tone: "",
    sub: `used ${fmtBytes(fsUsed(s))}`,
    share: live ? usedShare(live.sys.fs_free, live.sys.fs_size) : null,
    points: points.fs,
    options: PCT,
  };
}

function latencyMetric({ s, points }: Ctx): Metric {
  return {
    name: "latency",
    label: "latency",
    value: s ? `${s.latencyMs} ms` : "—",
    tone: "",
    sub: "RPC round trip",
    share: s ? Math.min(1, s.latencyMs / 500) : null,
    points: points.latency,
    options: { unit: "ms", extremeLabel: "peak" },
  };
}

function tempMetric({ s, points }: Ctx): Metric {
  const tempC = s?.temperatureC ?? null;
  const temps = points.temp
    .map((p) => p.y)
    .filter((y): y is number => typeof y === "number");
  return {
    name: "temp",
    label: "temp",
    value: tempC == null ? "—" : `${tempC.toFixed(1)} °C`,
    tone: tempC != null && tempC >= 40 ? "warn" : "",
    sub: s?.temperatureFrom
      ? `from ${s.temperatureFrom}`
      : "no temperature component",
    share: tempC == null ? null : Math.min(1, Math.max(0, tempC / 85)),
    points: points.temp,
    options: {
      unit: "°C",
      domainMin: temps.length ? Math.floor(Math.min(...temps)) - 1 : 0,
      domainMax: temps.length ? Math.ceil(Math.max(...temps)) + 1 : 1,
      extremeLabel: "peak",
    },
    title: s ? tempTitle(s) : undefined,
  };
}

function rssiMetric({ s, points }: Ctx): Metric {
  const rssi = s?.wifi.rssi ?? null;
  return {
    name: "rssi",
    label: "rssi",
    value: rssi == null ? "—" : `${rssi} dBm`,
    tone: "",
    sub: s?.wifi.ssid ? `ssid ${s.wifi.ssid}` : "wifi signal",
    share:
      rssi == null
        ? null
        : Math.min(1, Math.max(0, (rssi - RSSI_FLOOR) / (RSSI_CEIL - RSSI_FLOOR))),
    points: points.rssi,
    options: {
      unit: "dBm",
      domainMin: RSSI_FLOOR,
      domainMax: RSSI_CEIL,
      extreme: "min",
      extremeLabel: "worst",
    },
  };
}

const BUILDERS = [
  scriptMetric,
  memMetric,
  cpuMetric,
  ramMetric,
  fsMetric,
  latencyMetric,
  tempMetric,
  rssiMetric,
];

/** `script` and `rssi` carry no "nearly full" meaning, so they never auto-warn. */
const NO_AUTO_WARN = new Set(["script", "rssi"]);

function withWarnTone(m: Metric): Metric {
  if (m.tone || NO_AUTO_WARN.has(m.name)) return m;
  const warn = m.share != null && m.share >= WARN_SHARE;
  return { ...m, tone: warn ? "warn" : "" };
}

export function metricsOf(
  s: DeviceStatus | null,
  err: string | null,
  points: Record<HistoryName, SparkPoint[]>,
): Metric[] {
  const ctx: Ctx = { s, live: err ? null : s, points };
  return BUILDERS.map((build) => withWarnTone(build(ctx)));
}
