import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Collapsible } from "../ui/collapsible";
import { createHistory } from "../charts/metric-history";
import { MiniBars } from "../charts/mini-bars";
import { MetricSwapCell } from "../stats/metric-swap";
import { CLOSE_MENUS_EVENT, closeAllMenus } from "../ui/split-button";
import type { SparkPoint } from "../charts/spark";
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
  type DeviceIdentity,
  type DeviceStatus,
} from "./device-format";

export type { DeviceIdentity, DeviceStatus };

type ApiFn = typeof apiFn;

const POLL_MS = 5_000;

export type DevicePanelProps = {
  api: ApiFn;
  onStatus: (msg: string, isError?: boolean) => void;
  onIdentity: (id: DeviceIdentity) => void;
  onMeta?: (text: string) => void;
  onReady?: (api: { refresh: () => Promise<void> }) => void;
};

export function DevicePanel(props: DevicePanelProps) {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ecoChecked, setEcoChecked] = useState(false);
  const [ecoDisabled, setEcoDisabled] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rebootBusy, setRebootBusy] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  const ecoBusy = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const latencyHist = useRef(createHistory("latency"));
  const rssiHist = useRef(createHistory("rssi"));
  const tempHist = useRef(createHistory("temp"));
  const [latencyPts, setLatencyPts] = useState<SparkPoint[]>(() =>
    latencyHist.current.read(),
  );
  const [rssiPts, setRssiPts] = useState<SparkPoint[]>(() =>
    rssiHist.current.read(),
  );
  const [tempPts, setTempPts] = useState<SparkPoint[]>(() =>
    tempHist.current.read(),
  );

  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    async function refresh() {
      try {
        const data = await propsRef.current.api<{ status: DeviceStatus }>(
          "/api/device/status",
        );
        const s = data.status;
        setStatus(s);
        setErr(null);
        setPollTick((n) => n + 1);
        setLatencyPts(latencyHist.current.push(s.latencyMs));
        const rssi = s.wifi.rssi;
        setRssiPts(
          rssi == null
            ? rssiHist.current.push(null)
            : rssiHist.current.push(rssi),
        );
        const tempC = s.temperatureC;
        setTempPts(
          tempC == null
            ? tempHist.current.push(null)
            : tempHist.current.push(Math.round(tempC * 10) / 10),
        );
        if (!ecoBusy.current) {
          setEcoDisabled(s.eco_mode == null);
          if (s.eco_mode != null) setEcoChecked(s.eco_mode);
        }
        const meta = deviceMetaText(s);
        propsRef.current.onMeta?.(meta);
        const running = s.script.running;
        propsRef.current.onIdentity({
          deviceName: s.device.name ?? s.device.id ?? null,
          scriptName: s.script.name,
          state: running == null ? "unknown" : running ? "running" : "stopped",
          memPeak: s.script.mem_peak,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
        setEcoDisabled(true);
        setStatus(null);
        setPollTick((n) => n + 1);
        setLatencyPts(latencyHist.current.push(null));
        setRssiPts(rssiHist.current.push(null));
        setTempPts(tempHist.current.push(null));
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
  }, []);

  useEffect(() => {
    const close = () => setMenuOpen(false);
    document.addEventListener(CLOSE_MENUS_EVENT, close);
    return () => document.removeEventListener(CLOSE_MENUS_EVENT, close);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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
    setMenuOpen(false);
    try {
      await props.api("/api/device/reboot", { method: "POST", body: "{}" });
      props.onStatus("reboot requested — device will restart");
    } catch (e) {
      props.onStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      setRebootBusy(false);
    }
  }

  const peek = err
    ? err.length > 48
      ? `${err.slice(0, 45)}…`
      : err
    : status
      ? buildPeek(status)
      : "—";
  const peekError = !!err;
  const meta = status ? deviceMetaText(status) : "—";
  const offline = !!err || !status;

  const mem_used = status?.script.mem_used ?? null;
  const mem_peak = status?.script.mem_peak ?? null;
  const mem_free = status?.script.mem_free ?? null;
  const cpu = status?.script.cpu ?? null;
  const memShare =
    mem_used == null || mem_free == null
      ? null
      : usedShare(mem_free, mem_used + mem_free);
  const cpuShare = cpu == null ? null : Math.min(1, cpu / 100);
  const ramShare = usedShare(
    status?.sys.ram_free ?? null,
    status?.sys.ram_size ?? null,
  );
  const fsShare = usedShare(
    status?.sys.fs_free ?? null,
    status?.sys.fs_size ?? null,
  );

  const running = status?.script.running;
  const runClass =
    running ? "ok" : running === false ? "warn" : "";

  const tempValues = tempPts
    .map((p) => p.y)
    .filter((y): y is number => typeof y === "number");
  const tempLo = tempValues.length ? Math.floor(Math.min(...tempValues)) - 1 : 0;
  const tempHi = tempValues.length ? Math.ceil(Math.max(...tempValues)) + 1 : 1;

  const onMenuToggle = (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const next = !menuOpen;
    if (next) closeAllMenus();
    setMenuOpen(next);
  };

  return (
    <Collapsible
      storageKey="shelly-devroom.devicePanel.collapsed"
      defaultCollapsed={true}
      ignoreSelector="label.eco, input, .device-actions"
      panelId="devicePanel"
      panelClass="device"
      bodyId="deviceBody"
      headId="deviceHead"
      toggleId="deviceToggle"
      title="Show or hide full device telemetry"
      ariaLabel="Device telemetry"
      headChildren={
        <>
          <h2>device</h2>
          <p class="device-meta" id="deviceMetaHead">
            {meta}
          </p>
          <p class={`panel-peek${peekError ? " error" : ""}`} id="devicePeek">
            {peek}
          </p>
          <div class="device-actions">
            <label
              class="eco"
              title="Sys.config.device.eco_mode — lower CPU clock + WiFi power-save; raises latency"
            >
              <input
                type="checkbox"
                id="ecoToggle"
                disabled={ecoDisabled}
                checked={ecoChecked}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  void toggleEco((e.target as HTMLInputElement).checked)
                }
              />
              eco
            </label>
            <div class="device-menu" id="deviceMenu" ref={menuRef}>
              <button
                type="button"
                id="btnDeviceMenu"
                class="device-menu-btn"
                data-testid="device-menu-btn"
                aria-haspopup="menu"
                aria-expanded={menuOpen ? "true" : "false"}
                aria-controls="deviceMenuList"
                title="Device actions"
                disabled={rebootBusy}
                onClick={onMenuToggle}
              >
                ⋯
              </button>
              <ul
                class="menu"
                id="deviceMenuList"
                role="menu"
                hidden={!menuOpen}
              >
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="device-reboot-item"
                    title="Shelly.Reboot — soft restart (not factory reset)"
                    disabled={offline || rebootBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void reboot();
                    }}
                  >
                    Reboot device
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </>
      }
    >
      <div class="device-body" id="deviceBody">
        <dl class="device-grid" id="deviceGrid">
          <div>
            <dt>script</dt>
            <dd
              id="dRunning"
              class={runClass}
              title={
                status?.script.errors.length
                  ? `errors: ${JSON.stringify(status.script.errors)}`
                  : undefined
              }
            >
              {running == null ? "—" : running ? "running" : "stopped"}
            </dd>
          </div>
          <MetricSwapCell
            name="mem"
            label="script memory used"
            dtLabel="mem used / peak / free"
            swapId="swapMem"
            ddId="dMem"
            gaugeId="gMem"
            histId="hMem"
            valueText={`${fmtBytes(mem_used)} / ${fmtBytes(mem_peak)} / ${fmtBytes(mem_free)}`}
            share={err ? null : memShare}
            tick={pollTick}
          />
          <MetricSwapCell
            name="cpu"
            label="cpu"
            dtLabel="cpu"
            swapId="swapCpu"
            ddId="dCpu"
            gaugeId="gCpu"
            histId="hCpu"
            valueText={cpu == null ? "—" : `${cpu}%`}
            share={err ? null : cpuShare}
            tick={pollTick}
          />
          <MetricSwapCell
            name="ram"
            label="device RAM used"
            dtLabel="ram free / size"
            swapId="swapRam"
            ddId="dRam"
            gaugeId="gRam"
            histId="hRam"
            valueText={fmtPair(
              status?.sys.ram_free ?? null,
              status?.sys.ram_size ?? null,
            )}
            share={err ? null : ramShare}
            tick={pollTick}
          />
          <MetricSwapCell
            name="fs"
            label="filesystem used"
            dtLabel="fs free / size"
            swapId="swapFs"
            ddId="dFs"
            gaugeId="gFs"
            histId="hFs"
            valueText={fmtPair(
              status?.sys.fs_free ?? null,
              status?.sys.fs_size ?? null,
            )}
            share={err ? null : fsShare}
            tick={pollTick}
          />
          <div>
            <dt>latency</dt>
            <dd id="dLatency">
              {status ? `${status.latencyMs} ms` : "—"}
            </dd>
            <MiniBars
              id="latencySpark"
              aria-label="RPC latency, last 5 minutes"
              points={latencyPts}
              options={{ unit: "ms", extremeLabel: "peak" }}
            />
          </div>
          <div>
            <dt>temp</dt>
            <dd id="dTemp" title={status ? tempTitle(status) : undefined}>
              {status?.temperatureC == null
                ? "—"
                : `${status.temperatureC.toFixed(1)} °C`}
            </dd>
            <MiniBars
              id="tempSpark"
              aria-label="Device temperature, last 5 minutes"
              points={tempPts}
              options={{
                unit: "°C",
                domainMin: tempLo,
                domainMax: tempHi,
                extremeLabel: "peak",
              }}
            />
          </div>
          <div>
            <dt>rssi</dt>
            <dd id="dRssi">
              {status?.wifi.rssi == null ? "—" : `${status.wifi.rssi} dBm`}
            </dd>
            <MiniBars
              id="rssiSpark"
              aria-label="WiFi signal, last 5 minutes"
              points={rssiPts}
              options={{
                unit: "dBm",
                domainMin: RSSI_FLOOR,
                domainMax: RSSI_CEIL,
                extreme: "min",
                extremeLabel: "worst",
              }}
            />
          </div>
        </dl>
        <p class="device-err" id="deviceErr" hidden={!err}>
          {err ?? ""}
        </p>
      </div>
    </Collapsible>
  );
}
