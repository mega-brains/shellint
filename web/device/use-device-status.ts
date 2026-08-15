import { useEffect, useRef, useState } from "preact/hooks";
import { createHistory } from "../charts/metric-history";
import type { SparkPoint } from "../charts/spark";
import type { MiniBarsOptions } from "../charts/mini-bars";
import type { api as apiFn } from "../lib/api";
import {
  buildPeek,
  deviceMetaText,
  fmtBytes,
  fmtPair,
  RSSI_CEIL,
  RSSI_FLOOR,
  tempTitle,
  usedShare,
  WARN_SHARE,
  type DeviceIdentity,
  type DeviceStatus,
} from "./device-format";

const POLL_MS = 5_000;

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

export type DeviceStatusState = {
  status: DeviceStatus | null;
  err: string | null;
  /** Dense one-liner for the collapsed dock. */
  peek: string;
  /** "S3PL-00112EU · ESP32-C3 (inferred) · fw 2.0.0 · gen 3". */
  meta: string;
  offline: boolean;
  metrics: Metric[];
  eco: { checked: boolean; disabled: boolean; toggle: (on: boolean) => void };
  reboot: () => void;
  rebootBusy: boolean;
  refresh: () => Promise<void>;
};

export type UseDeviceStatusProps = {
  /** False in the static build: no device exists, so no polling ever starts. */
  enabled: boolean;
  api: typeof apiFn;
  onStatus: (msg: string, isError?: boolean) => void;
  onIdentity: (id: DeviceIdentity) => void;
  onMeta?: (text: string) => void;
  onReady?: (ctl: { refresh: () => Promise<void> }) => void;
};

const HISTORY_NAMES = [
  "mem",
  "cpu",
  "ram",
  "fs",
  "latency",
  "temp",
  "rssi",
] as const;
type HistoryName = (typeof HISTORY_NAMES)[number];

/**
 * Device telemetry polling, eco toggle and reboot — the model behind the dock's
 * device tab (M18). Extracted from the old `DevicePanel` so the dock header can
 * show the live peek and the eco toggle while the tiles themselves are
 * unmounted (collapsed dock, or the logs tab).
 */
export function useDeviceStatus(props: UseDeviceStatusProps): DeviceStatusState {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ecoChecked, setEcoChecked] = useState(false);
  const [ecoDisabled, setEcoDisabled] = useState(true);
  const [rebootBusy, setRebootBusy] = useState(false);
  const ecoBusy = useRef(false);

  const histories = useRef<Record<HistoryName, ReturnType<typeof createHistory>>>();
  if (!histories.current) {
    histories.current = Object.fromEntries(
      HISTORY_NAMES.map((n) => [n, createHistory(n)]),
    ) as Record<HistoryName, ReturnType<typeof createHistory>>;
  }
  const [points, setPoints] = useState<Record<HistoryName, SparkPoint[]>>(() =>
    Object.fromEntries(
      HISTORY_NAMES.map((n) => [n, histories.current![n].read()]),
    ) as Record<HistoryName, SparkPoint[]>,
  );

  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!props.enabled) return;
    const record = (values: Record<HistoryName, number | null>) => {
      setPoints(
        Object.fromEntries(
          HISTORY_NAMES.map((n) => [n, histories.current![n].push(values[n])]),
        ) as Record<HistoryName, SparkPoint[]>,
      );
    };

    async function refresh() {
      try {
        const data = await propsRef.current.api<{ status: DeviceStatus }>(
          "/api/device/status",
        );
        const s = data.status;
        setStatus(s);
        setErr(null);
        record({
          mem: sharePct(memShareOf(s)),
          cpu: sharePct(cpuShareOf(s)),
          ram: sharePct(usedShare(s.sys.ram_free, s.sys.ram_size)),
          fs: sharePct(usedShare(s.sys.fs_free, s.sys.fs_size)),
          latency: s.latencyMs,
          temp: s.temperatureC == null ? null : Math.round(s.temperatureC * 10) / 10,
          rssi: s.wifi.rssi ?? null,
        });
        if (!ecoBusy.current) {
          setEcoDisabled(s.eco_mode == null);
          if (s.eco_mode != null) setEcoChecked(s.eco_mode);
        }
        propsRef.current.onMeta?.(deviceMetaText(s));
        const running = s.script.running;
        propsRef.current.onIdentity({
          deviceName: s.device.name ?? s.device.id ?? null,
          scriptName: s.script.name,
          state: running == null ? "unknown" : running ? "running" : "stopped",
          memPeak: s.script.mem_peak,
        });
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setEcoDisabled(true);
        setStatus(null);
        record({
          mem: null, cpu: null, ram: null, fs: null,
          latency: null, temp: null, rssi: null,
        });
        propsRef.current.onIdentity({
          deviceName: null,
          scriptName: null,
          state: "offline",
          memPeak: null,
        });
      }
    }
    refreshRef.current = refresh;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refresh();
    }, POLL_MS);
    propsRef.current.onReady?.({ refresh: () => refreshRef.current() });
    return () => clearInterval(timer);
  }, [props.enabled]);

  async function toggleEco(next: boolean) {
    ecoBusy.current = true;
    setEcoDisabled(true);
    setEcoChecked(next);
    try {
      const data = await props.api<{
        eco_mode: boolean;
        restart_required: boolean | null;
      }>("/api/device/eco", {
        method: "POST",
        body: JSON.stringify({ eco_mode: next }),
      });
      setEcoChecked(data.eco_mode);
      props.onStatus(
        data.restart_required
          ? "eco set — device restart required"
          : `eco ${data.eco_mode ? "on" : "off"}`,
      );
      await refreshRef.current();
    } catch (e) {
      setEcoChecked(!next);
      props.onStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      ecoBusy.current = false;
      setEcoDisabled(false);
    }
  }

  async function reboot() {
    if (!window.confirm("Reboot the Shelly device now?")) return;
    setRebootBusy(true);
    try {
      await props.api("/api/device/reboot", { method: "POST", body: "{}" });
      props.onStatus("reboot requested — device will restart");
    } catch (e) {
      props.onStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      setRebootBusy(false);
    }
  }

  return {
    status,
    err,
    peek: err ? (err.length > 64 ? `${err.slice(0, 61)}…` : err) : status ? buildPeek(status) : "—",
    meta: status ? deviceMetaText(status) : "—",
    offline: !!err || !status,
    metrics: metricsOf(status, err, points),
    eco: { checked: ecoChecked, disabled: ecoDisabled, toggle: (on) => void toggleEco(on) },
    reboot: () => void reboot(),
    rebootBusy,
    refresh: () => refreshRef.current(),
  };
}

function sharePct(share: number | null): number | null {
  return share == null ? null : Math.round(share * 100);
}

function memShareOf(s: DeviceStatus): number | null {
  const used = s.script.mem_used;
  const free = s.script.mem_free;
  if (used == null || free == null) return null;
  return usedShare(free, used + free);
}

function ramUsed(s: DeviceStatus | null): number | null {
  if (!s || s.sys.ram_free == null || s.sys.ram_size == null) return null;
  return s.sys.ram_size - s.sys.ram_free;
}

function fsUsed(s: DeviceStatus | null): number | null {
  if (!s || s.sys.fs_free == null || s.sys.fs_size == null) return null;
  return s.sys.fs_size - s.sys.fs_free;
}

function cpuShareOf(s: DeviceStatus): number | null {
  return s.script.cpu == null ? null : Math.min(1, s.script.cpu / 100);
}

const PCT: MiniBarsOptions = { unit: "%", domainMin: 0, domainMax: 100 };

function metricsOf(
  s: DeviceStatus | null,
  err: string | null,
  points: Record<HistoryName, SparkPoint[]>,
): Metric[] {
  const live = !err && s;
  const running = s?.script.running;
  const temps = points.temp
    .map((p) => p.y)
    .filter((y): y is number => typeof y === "number");
  const tempC = s?.temperatureC ?? null;
  return [
    {
      name: "script",
      label: "script",
      value: running == null ? "—" : running ? "running" : "stopped",
      tone: running ? "ok" : running === false ? "warn" : "",
      sub: s?.script.errors.length ? `${s.script.errors.length} error(s)` : running == null ? "no device" : "slot " + (s?.scriptId ?? "?"),
      share: running == null ? null : running ? 1 : 0,
      points: [],
      options: PCT,
      title: s?.script.errors.length
        ? `errors: ${JSON.stringify(s.script.errors)}`
        : "Whether the deployed script is running on the device",
    },
    {
      name: "mem",
      label: "script mem used / peak",
      value: fmtBytes(s?.script.mem_used ?? null),
      tone: "",
      sub: `peak ${fmtBytes(s?.script.mem_peak ?? null)} · free ${fmtBytes(s?.script.mem_free ?? null)}`,
      share: live ? memShareOf(s) : null,
      points: points.mem,
      options: PCT,
      title: `used ${fmtBytes(s?.script.mem_used ?? null)} · peak ${fmtBytes(s?.script.mem_peak ?? null)} · free ${fmtBytes(s?.script.mem_free ?? null)}`,
    },
    {
      name: "cpu",
      label: "cpu",
      value: s?.script.cpu == null ? "—" : `${s.script.cpu}%`,
      tone: "",
      sub: "script CPU share reported by the device",
      share: live ? cpuShareOf(s) : null,
      points: points.cpu,
      options: PCT,
    },
    {
      name: "ram",
      label: "ram free / size",
      value: fmtPair(s?.sys.ram_free ?? null, s?.sys.ram_size ?? null),
      tone: "",
      sub: `used ${fmtBytes(ramUsed(s))}`,
      share: live ? usedShare(s.sys.ram_free, s.sys.ram_size) : null,
      points: points.ram,
      options: PCT,
    },
    {
      name: "fs",
      label: "fs free / size",
      value: fmtPair(s?.sys.fs_free ?? null, s?.sys.fs_size ?? null),
      tone: "",
      sub: `used ${fmtBytes(fsUsed(s))}`,
      share: live ? usedShare(s.sys.fs_free, s.sys.fs_size) : null,
      points: points.fs,
      options: PCT,
    },
    {
      name: "latency",
      label: "latency",
      value: s ? `${s.latencyMs} ms` : "—",
      tone: "",
      sub: "RPC round trip",
      share: s ? Math.min(1, s.latencyMs / 500) : null,
      points: points.latency,
      options: { unit: "ms", extremeLabel: "peak" },
    },
    {
      name: "temp",
      label: "temp",
      value: tempC == null ? "—" : `${tempC.toFixed(1)} °C`,
      tone: tempC != null && tempC >= 40 ? "warn" : "",
      sub: s?.temperatureFrom ? `from ${s.temperatureFrom}` : "no temperature component",
      share: tempC == null ? null : Math.min(1, Math.max(0, tempC / 85)),
      points: points.temp,
      options: {
        unit: "°C",
        domainMin: temps.length ? Math.floor(Math.min(...temps)) - 1 : 0,
        domainMax: temps.length ? Math.ceil(Math.max(...temps)) + 1 : 1,
        extremeLabel: "peak",
      },
      title: s ? tempTitle(s) : undefined,
    },
    {
      name: "rssi",
      label: "rssi",
      value: s?.wifi.rssi == null ? "—" : `${s.wifi.rssi} dBm`,
      tone: "",
      sub: s?.wifi.ssid ? `ssid ${s.wifi.ssid}` : "wifi signal",
      share:
        s?.wifi.rssi == null
          ? null
          : Math.min(1, Math.max(0, (s.wifi.rssi - RSSI_FLOOR) / (RSSI_CEIL - RSSI_FLOOR))),
      points: points.rssi,
      options: {
        unit: "dBm",
        domainMin: RSSI_FLOOR,
        domainMax: RSSI_CEIL,
        extreme: "min",
        extremeLabel: "worst",
      },
    },
  ].map((m) => ({
    ...m,
    tone:
      m.tone ||
      (m.share != null && m.share >= WARN_SHARE && m.name !== "script" && m.name !== "rssi"
        ? "warn"
        : ""),
  })) as Metric[];
}
