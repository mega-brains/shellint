const STORAGE_KEY = "shelly-devroom.devicePanel.collapsed";
const POLL_MS = 5_000;

export type DeviceStatus = {
  deviceIp: string;
  scriptId: number;
  latencyMs: number;
  device: {
    model?: string;
    gen?: number | string;
    ver?: string;
    chip: string;
  };
  script: {
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
};

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

function readCollapsed(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === null) return true; // default collapsed
    return v === "1";
  } catch {
    return true;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function createDevicePanel(
  els: DevicePanelEls,
  api: ApiFn,
  onStatus: (msg: string, isError?: boolean) => void,
) {
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let ecoBusy = false;

  function setCollapsed(collapsed: boolean) {
    els.panel.classList.toggle("collapsed", collapsed);
    els.head.setAttribute("aria-expanded", collapsed ? "false" : "true");
    els.toggle.textContent = collapsed ? "▸" : "▾";
    writeCollapsed(collapsed);
  }

  function toggleCollapsed() {
    setCollapsed(!els.panel.classList.contains("collapsed"));
  }

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
    els.dTemp.textContent =
      status.temperatureC == null
        ? "—"
        : `${status.temperatureC.toFixed(1)} °C`;
    els.dRssi.textContent =
      status.wifi.rssi == null ? "—" : `${status.wifi.rssi} dBm`;

    if (!ecoBusy) {
      els.ecoToggle.disabled = status.eco_mode == null;
      if (status.eco_mode != null) els.ecoToggle.checked = status.eco_mode;
    }
    if (status.sys.restart_required) {
      els.meta.textContent += " · restart required";
    }

    const runLabel =
      running == null ? "—" : running ? "running" : "stopped";
    const mem = fmtBytes(mem_peak ?? mem_used);
    const cpuLabel = cpu == null ? "—" : `${cpu}%`;
    setPeek(
      `${runLabel} · mem ${mem} · cpu ${cpuLabel} · ${status.latencyMs} ms`,
    );
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
      const short =
        msg.length > 48 ? `${msg.slice(0, 45)}…` : msg || "offline";
      setPeek(short, true);
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

  // Header toggles collapse; eco checkbox must not bubble.
  els.head.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("label.eco, input")) return;
    toggleCollapsed();
  });
  els.head.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleCollapsed();
    }
  });
  els.ecoToggle.addEventListener("change", () => void toggleEco());
  els.ecoToggle.addEventListener("click", (e) => e.stopPropagation());

  setCollapsed(readCollapsed());

  return { startPoll, refresh };
}
