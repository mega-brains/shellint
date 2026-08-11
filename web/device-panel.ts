import { createCollapsible } from "./collapsible";

const STORAGE_KEY = "shelly-devroom.devicePanel.collapsed";
const POLL_MS = 5_000;

export type DeviceStatus = {
  deviceIp: string;
  scriptId: number;
  latencyMs: number;
  device: {
    id?: string;
    name?: string;
    model?: string;
    gen?: number | string;
    ver?: string;
    chip: string;
  };
  script: {
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
    fs_size: number | null;
    fs_free: number | null;
    restart_required: boolean | null;
  };
  eco_mode: boolean | null;
  temperatureC: number | null;
  wifi: { rssi: number | null; ssid: string | null };
};

export type DevicePanelEls = {
  panel: HTMLElement;
  head: HTMLElement;
  toggle: HTMLElement;
  peek: HTMLElement;
  body: HTMLElement;
  meta: HTMLElement;
  err: HTMLElement;
  ecoToggle: HTMLInputElement;
  dRunning: HTMLElement;
  dMem: HTMLElement;
  dCpu: HTMLElement;
  dRam: HTMLElement;
  dFs: HTMLElement;
  dLatency: HTMLElement;
  dTemp: HTMLElement;
  dRssi: HTMLElement;
  gMem: HTMLElement;
  gCpu: HTMLElement;
  gRam: HTMLElement;
  gFs: HTMLElement;
  gRssi: HTMLElement;
};

/** dBm window used to turn RSSI into a 0–1 signal-quality share. */
const RSSI_FLOOR = -100;
const RSSI_CEIL = -30;
const WARN_SHARE = 0.8;

type ApiFn = <T>(
  path: string,
  init?: RequestInit,
) => Promise<T & { ok: boolean; error?: string }>;

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtPair(a: number | null, b: number | null): string {
  if (a == null && b == null) return "—";
  return `${fmtBytes(a)} / ${fmtBytes(b)}`;
}

/** Same pair with the unit stated once — for the width-starved collapsed row. */
function fmtPairTight(a: number | null, b: number | null): string {
  if (a == null && b == null) return "—";
  const left = fmtBytes(a);
  const right = fmtBytes(b);
  const unit = left.split(" ")[1];
  if (unit && unit === right.split(" ")[1]) {
    return `${left.split(" ")[0]}/${right}`;
  }
  return `${left}/${right}`;
}

/**
 * Fill share for a used/total pair. Bars show the *used* portion even where the
 * label reads "free / size", so a fuller bar always means less headroom.
 */
function usedShare(free: number | null, size: number | null): number | null {
  if (free == null || size == null || size <= 0) return null;
  return Math.min(1, Math.max(0, (size - free) / size));
}

function setGauge(
  el: HTMLElement,
  share: number | null,
  label: string,
  warn?: boolean,
): void {
  const fill = el.firstElementChild as HTMLElement | null;
  const idle = share == null;
  el.classList.toggle("idle", idle);
  el.classList.toggle("warn", !idle && (warn ?? share >= WARN_SHARE));
  if (fill) fill.style.width = idle ? "0%" : `${(share * 100).toFixed(1)}%`;
  el.setAttribute("role", "progressbar");
  el.setAttribute("aria-valuemin", "0");
  el.setAttribute("aria-valuemax", "100");
  if (idle) {
    el.removeAttribute("aria-valuenow");
    el.setAttribute("aria-label", `${label} unavailable`);
    return;
  }
  const pct = Math.round(share * 100);
  el.setAttribute("aria-valuenow", String(pct));
  el.setAttribute("aria-label", `${label} ${pct}%`);
}

/**
 * Collapsed summary — the whole body condensed into one row, widest first so
 * the least useful fields are the ones the ellipsis eats on a narrow window.
 */
function buildPeek(status: DeviceStatus): string {
  const { script, sys, wifi, device } = status;
  const runLabel =
    script.running == null ? "—" : script.running ? "running" : "stopped";
  const parts = [
    device.model,
    device.ver ? `fw ${device.ver}` : null,
    runLabel,
    script.errors.length ? script.errors.join(", ") : null,
    script.mem_used == null && script.mem_peak == null
      ? `mem free ${fmtBytes(script.mem_free)}`
      : `mem ${fmtPairTight(script.mem_used, script.mem_peak)} peak`,
    script.cpu == null ? null : `cpu ${script.cpu}%`,
    `${status.latencyMs} ms`,
    `ram ${fmtPairTight(sys.ram_free, sys.ram_size)}`,
    `fs ${fmtPairTight(sys.fs_free, sys.fs_size)}`,
    status.temperatureC == null
      ? null
      : `${status.temperatureC.toFixed(1)} °C`,
    wifi.rssi == null ? null : `${wifi.rssi} dBm`,
    status.eco_mode == null ? null : `eco ${status.eco_mode ? "on" : "off"}`,
    sys.restart_required ? "restart required" : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export type DeviceIdentity = {
  deviceName: string | null;
  scriptName: string | null;
  state: "running" | "stopped" | "unknown" | "offline";
  /** Measured high-water mark, for the dashboard to check its estimate against. */
  memPeak: number | null;
};

export function createDevicePanel(
  els: DevicePanelEls,
  api: ApiFn,
  onStatus: (msg: string, isError?: boolean) => void,
  onIdentity: (id: DeviceIdentity) => void = () => {},
) {
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let ecoBusy = false;

  createCollapsible(els, {
    storageKey: STORAGE_KEY,
    defaultCollapsed: true,
    ignoreSelector: "label.eco, input",
  });

  function setPeek(text: string, isError = false) {
    els.peek.textContent = text;
    els.peek.classList.toggle("error", isError);
  }

  function render(status: DeviceStatus) {
    els.err.hidden = true;
    els.err.textContent = "";

    const d = status.device;
    const parts = [
      d.model,
      d.chip ? `${d.chip} (inferred)` : null,
      d.ver ? `fw ${d.ver}` : null,
      d.gen != null ? `gen ${d.gen}` : null,
    ].filter(Boolean);
    els.meta.textContent = parts.join(" · ") || "—";

    const running = status.script.running;
    els.dRunning.textContent =
      running == null ? "—" : running ? "running" : "stopped";
    els.dRunning.className = running ? "ok" : running === false ? "warn" : "";

    const { mem_used, mem_peak, mem_free, errors, cpu } = status.script;
    els.dMem.textContent = `${fmtBytes(mem_used)} / ${fmtBytes(mem_peak)} / ${fmtBytes(mem_free)}`;
    if (errors.length) els.dRunning.title = `errors: ${JSON.stringify(errors)}`;
    else els.dRunning.removeAttribute("title");

    els.dCpu.textContent = cpu == null ? "—" : `${cpu}%`;
    els.dRam.textContent = fmtPair(status.sys.ram_free, status.sys.ram_size);
    els.dFs.textContent = fmtPair(status.sys.fs_free, status.sys.fs_size);
    els.dLatency.textContent = `${status.latencyMs} ms`;

    // Script heap has no reported total, so scale used against used + free.
    setGauge(
      els.gMem,
      mem_used == null || mem_free == null
        ? null
        : usedShare(mem_free, mem_used + mem_free),
      "script memory used",
    );
    setGauge(els.gCpu, cpu == null ? null : Math.min(1, cpu / 100), "cpu");
    setGauge(
      els.gRam,
      usedShare(status.sys.ram_free, status.sys.ram_size),
      "device RAM used",
    );
    setGauge(
      els.gFs,
      usedShare(status.sys.fs_free, status.sys.fs_size),
      "filesystem used",
    );
    els.dTemp.textContent =
      status.temperatureC == null
        ? "—"
        : `${status.temperatureC.toFixed(1)} °C`;
    const rssi = status.wifi.rssi;
    els.dRssi.textContent = rssi == null ? "—" : `${rssi} dBm`;
    const signal =
      rssi == null
        ? null
        : Math.min(
            1,
            Math.max(0, (rssi - RSSI_FLOOR) / (RSSI_CEIL - RSSI_FLOOR)),
          );
    // Inverted: a short signal bar is the bad case, unlike the usage bars.
    setGauge(els.gRssi, signal, "wifi signal", signal != null && signal < 0.3);

    if (!ecoBusy) {
      els.ecoToggle.disabled = status.eco_mode == null;
      if (status.eco_mode != null) els.ecoToggle.checked = status.eco_mode;
    }
    if (status.sys.restart_required) {
      els.meta.textContent += " · restart required";
    }

    setPeek(buildPeek(status));
    onIdentity({
      deviceName: status.device.name ?? status.device.id ?? null,
      scriptName: status.script.name,
      state: running == null ? "unknown" : running ? "running" : "stopped",
      memPeak: status.script.mem_peak,
    });
  }

  async function refresh() {
    try {
      const data = await api<{ status: DeviceStatus }>("/api/device/status");
      render(data.status);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      els.err.hidden = false;
      els.err.textContent = msg;
      els.ecoToggle.disabled = true;
      for (const [el, label] of [
        [els.gMem, "script memory used"],
        [els.gCpu, "cpu"],
        [els.gRam, "device RAM used"],
        [els.gFs, "filesystem used"],
        [els.gRssi, "wifi signal"],
      ] as const) {
        setGauge(el, null, label);
      }
      const short =
        msg.length > 48 ? `${msg.slice(0, 45)}…` : msg || "offline";
      setPeek(short, true);
      onIdentity({
        deviceName: null,
        scriptName: null,
        state: "offline",
        memPeak: null,
      });
    }
  }

  function startPoll() {
    void refresh();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refresh();
    }, POLL_MS);
  }

  async function toggleEco() {
    const next = els.ecoToggle.checked;
    ecoBusy = true;
    els.ecoToggle.disabled = true;
    try {
      const data = await api<{
        eco_mode: boolean;
        restart_required: boolean | null;
      }>("/api/device/eco", {
        method: "POST",
        body: JSON.stringify({ eco_mode: next }),
      });
      els.ecoToggle.checked = data.eco_mode;
      onStatus(
        data.restart_required
          ? "eco set — device restart required"
          : `eco ${data.eco_mode ? "on" : "off"}`,
      );
      await refresh();
    } catch (e) {
      els.ecoToggle.checked = !next;
      onStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      ecoBusy = false;
      els.ecoToggle.disabled = false;
    }
  }

  els.ecoToggle.addEventListener("change", () => void toggleEco());
  els.ecoToggle.addEventListener("click", (e) => e.stopPropagation());

  return { startPoll, refresh };
}
