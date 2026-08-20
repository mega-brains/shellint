import { useEffect, useRef, useState } from "preact/hooks";
import { createHistory } from "../charts/metric-history";
import type { SparkPoint } from "../charts/spark";
import type { api as apiFn } from "../lib/api";
import {
  buildPeek,
  deviceMetaText,
  usedShare,
  type DeviceIdentity,
  type DeviceStatus,
} from "./device-format";
import {
  cpuShareOf,
  HISTORY_NAMES,
  memShareOf,
  metricsOf,
  sharePct,
  type HistoryName,
  type Metric,
} from "./status-metrics";

export type { Metric };

const POLL_MS = 5_000;

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
