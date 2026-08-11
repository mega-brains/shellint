import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";

type Mode = "debug" | "prod";
type Minify = "min" | "raw";

type DeviceStatus = {
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

const POLL_MS = 5_000;

const el = {
  editor: document.getElementById("editor")!,
  save: document.getElementById("btnSave") as HTMLButtonElement,
  build: document.getElementById("btnBuild") as HTMLButtonElement,
  deploy: document.getElementById("btnDeploy") as HTMLButtonElement,
  deployMenuBtn: document.getElementById("btnDeployMenu") as HTMLButtonElement,
  deployMenu: document.getElementById("deployMenu") as HTMLUListElement,
  deploySplit: document.getElementById("deploySplit") as HTMLDivElement,
  probe: document.getElementById("btnProbe") as HTMLButtonElement,
  status: document.getElementById("statusLine")!,
  sizeDebug: document.getElementById("sizeDebug")!,
  sizeProd: document.getElementById("sizeProd")!,
  scriptStats: document.getElementById("scriptStats")!,
  buildHistory: document.getElementById("buildHistory")!,
  configLine: document.getElementById("configLine")!,
  deviceMeta: document.getElementById("deviceMeta")!,
  deviceErr: document.getElementById("deviceErr")!,
  ecoToggle: document.getElementById("ecoToggle") as HTMLInputElement,
  dRunning: document.getElementById("dRunning")!,
  dMem: document.getElementById("dMem")!,
  dCpu: document.getElementById("dCpu")!,
  dRam: document.getElementById("dRam")!,
  dFs: document.getElementById("dFs")!,
  dLatency: document.getElementById("dLatency")!,
  dTemp: document.getElementById("dTemp")!,
  dRssi: document.getElementById("dRssi")!,
};

let deployChoice: { mode: Mode; minify: Minify } = {
  mode: "debug",
  minify: "min",
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let ecoBusy = false;

function minifyLabel(m: Minify): string {
  return m === "raw" ? "non-minified" : "minified";
}

function shortMinify(m: Minify): string {
  return m === "raw" ? "raw" : "min";
}

function syncDeployLabel() {
  const { mode, minify } = deployChoice;
  const short = shortMinify(minify);
  const file = minify === "raw" ? `dist/${mode}.raw.js` : `dist/${mode}.js`;
  el.deploy.textContent = `Deploy ${mode} · ${short}`;
  el.deploy.title = `Upload ${file} (${mode}, ${minifyLabel(minify)}) to the Shelly script slot over WebSocket RPC`;
}

function setMenuOpen(open: boolean) {
  el.deployMenu.hidden = !open;
  el.deployMenuBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

function setStatus(msg: string, isError = false) {
  el.status.textContent = msg;
  el.status.classList.toggle("error", isError);
}

function formatSizes(pair: { raw?: number; min?: number } | undefined): string {
  if (!pair) return "—";
  const parts: string[] = [];
  if (pair.raw != null) parts.push(`raw ${pair.raw} B`);
  if (pair.min != null) parts.push(`min ${pair.min} B`);
  return parts.length ? parts.join(" · ") : "—";
}

type ScriptStats = {
  apis: Record<string, number>;
  registrations: {
    timers: number;
    eventHandlers: number;
    statusHandlers: number;
    httpEndpoints: number;
    rpcHandlers: number;
  };
  declarations: { vars: number; functions: number };
  literals: { strings: { count: number; totalBytes: number } };
  logging: { consoleLog: number; print: number };
  network: { shellyCall: number };
  nesting: { maxAnonymousDepth: number };
};

function formatStats(stats: ScriptStats | null | undefined): string {
  if (!stats) return "—";
  const apiN = Object.keys(stats.apis).length;
  const apiCalls = Object.values(stats.apis).reduce((a, b) => a + b, 0);
  const r = stats.registrations;
  const lines = [
    `apis ${apiN} kinds / ${apiCalls} calls`,
    `vars ${stats.declarations.vars} · fn ${stats.declarations.functions}`,
    `str ${stats.literals.strings.count} (${stats.literals.strings.totalBytes} B)`,
    `log ${stats.logging.consoleLog} · print ${stats.logging.print}`,
    `Timer.set ${r.timers} · Shelly.call ${stats.network.shellyCall}`,
    `anon nest ${stats.nesting.maxAnonymousDepth}`,
  ];
  return lines.join("\n");
}

function renderStats(stats: ScriptStats | null | undefined) {
  el.scriptStats.textContent = formatStats(stats);
}

type HistoryRow = {
  ts: string;
  sizes: {
    debug: { raw?: number; min?: number };
    prod: { raw?: number; min?: number };
  };
};

function renderHistory(rows: HistoryRow[]) {
  el.buildHistory.replaceChildren();
  if (!rows.length) {
    const li = document.createElement("li");
    li.textContent = "no builds yet";
    el.buildHistory.appendChild(li);
    return;
  }
  for (const row of rows.slice(0, 12)) {
    const li = document.createElement("li");
    const t = new Date(row.ts);
    const when = Number.isNaN(t.getTime())
      ? row.ts
      : t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const d = row.sizes.debug.min ?? row.sizes.debug.raw ?? "—";
    const p = row.sizes.prod.min ?? row.sizes.prod.raw ?? "—";
    li.textContent = `${when}  d ${d} · p ${p}`;
    el.buildHistory.appendChild(li);
  }
}

async function loadHistory() {
  try {
    const data = await api<{ history: HistoryRow[] }>("/api/history?limit=12");
    renderHistory(data.history);
  } catch {
    renderHistory([]);
  }
}

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

async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const data = (await res.json()) as T & { ok: boolean; error?: string };
  if (res.status === 401 || data.error === "auth not supported yet") {
    throw new Error("auth not supported yet");
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function renderDevice(status: DeviceStatus) {
  el.deviceErr.hidden = true;
  el.deviceErr.textContent = "";

  const d = status.device;
  const parts = [
    d.model,
    d.chip ? `${d.chip} (inferred)` : null,
    d.ver ? `fw ${d.ver}` : null,
    d.gen != null ? `gen ${d.gen}` : null,
  ].filter(Boolean);
  el.deviceMeta.textContent = parts.join(" · ") || "—";

  const running = status.script.running;
  el.dRunning.textContent =
    running == null ? "—" : running ? "running" : "stopped";
  el.dRunning.className = running ? "ok" : running === false ? "warn" : "";

  const { mem_used, mem_peak, mem_free, errors } = status.script;
  el.dMem.textContent = `${fmtBytes(mem_used)} / ${fmtBytes(mem_peak)} / ${fmtBytes(mem_free)}`;
  if (errors.length) {
    el.dRunning.title = `errors: ${JSON.stringify(errors)}`;
  } else {
    el.dRunning.removeAttribute("title");
  }

  el.dCpu.textContent =
    status.script.cpu == null ? "—" : `${status.script.cpu}%`;
  el.dRam.textContent = fmtPair(status.sys.ram_free, status.sys.ram_size);
  el.dFs.textContent = fmtPair(status.sys.fs_free, status.sys.fs_size);
  el.dLatency.textContent = `${status.latencyMs} ms`;
  el.dTemp.textContent =
    status.temperatureC == null ? "—" : `${status.temperatureC.toFixed(1)} °C`;
  el.dRssi.textContent =
    status.wifi.rssi == null ? "—" : `${status.wifi.rssi} dBm`;

  if (!ecoBusy) {
    el.ecoToggle.disabled = status.eco_mode == null;
    if (status.eco_mode != null) el.ecoToggle.checked = status.eco_mode;
  }

  if (status.sys.restart_required) {
    el.deviceMeta.textContent += " · restart required";
  }
}

async function refreshDevice() {
  try {
    const data = await api<{ status: DeviceStatus }>("/api/device/status");
    renderDevice(data.status);
  } catch (e) {
    el.deviceErr.hidden = false;
    el.deviceErr.textContent = e instanceof Error ? e.message : String(e);
    el.ecoToggle.disabled = true;
  }
}

function startDevicePoll() {
  void refreshDevice();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    void refreshDevice();
  }, POLL_MS);
}

async function toggleEco() {
  const next = el.ecoToggle.checked;
  ecoBusy = true;
  el.ecoToggle.disabled = true;
  try {
    const data = await api<{
      eco_mode: boolean;
      restart_required: boolean | null;
    }>("/api/device/eco", {
      method: "POST",
      body: JSON.stringify({ eco_mode: next }),
    });
    el.ecoToggle.checked = data.eco_mode;
    const note = data.restart_required
      ? "eco set — device restart required"
      : `eco ${data.eco_mode ? "on" : "off"}`;
    setStatus(note);
    await refreshDevice();
  } catch (e) {
    el.ecoToggle.checked = !next;
    setStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    ecoBusy = false;
    el.ecoToggle.disabled = false;
  }
}

let view: EditorView;

async function loadScript() {
  const data = await api<{ source: string }>("/api/script");
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: data.source },
  });
  setStatus("loaded scripts/main.ts");
}

async function saveScript() {
  const source = view.state.doc.toString();
  await api("/api/script", {
    method: "PUT",
    body: JSON.stringify({ source }),
  });
  setStatus(`saved (${new TextEncoder().encode(source).length} B)`);
}

async function buildScript() {
  setStatus("building…");
  const data = await api<{
    sizes: {
      debug: { raw?: number; min?: number };
      prod: { raw?: number; min?: number };
    };
    stats?: ScriptStats;
  }>("/api/build", { method: "POST", body: "{}" });
  el.sizeDebug.textContent = formatSizes(data.sizes.debug);
  el.sizeProd.textContent = formatSizes(data.sizes.prod);
  renderStats(data.stats);
  await loadHistory();
  const dialect = (data as { dialect?: { file: string; ok: boolean; findings: { severity: string; rule: string; message: string; line?: number }[] }[] }).dialect;
  if (dialect?.length) {
    const bad = dialect.flatMap((r) =>
      r.findings.map(
        (f) =>
          `${f.severity} ${r.file}${f.line != null ? `:${f.line}` : ""} ${f.rule}: ${f.message}`,
      ),
    );
    if (bad.length) {
      setStatus(`build ok with dialect notes\n${bad.join("\n")}`, true);
      return;
    }
  }
  setStatus("build ok");
}

async function deployScript(choice = deployChoice) {
  const { mode, minify } = choice;
  const label = minifyLabel(minify);
  setStatus(`deploy ${mode}/${label}: connecting…`);
  const data = await api<{
    localBytes: number;
    deviceLen: number | null;
    status: string;
    scriptId: number;
    minify: string;
  }>("/api/deploy", {
    method: "POST",
    body: JSON.stringify({ mode, minify }),
  });
  const len =
    data.deviceLen != null
      ? `device len ${data.deviceLen} (local ${data.localBytes})`
      : `local ${data.localBytes} B`;
  setStatus(
    `deploy ${mode}/${label}: ${data.status} · scriptId ${data.scriptId} · ${len}`,
  );
  void refreshDevice();
}

async function probeDevice() {
  setStatus("probing…");
  const data = await api<{
    report: {
      results: {
        id: string;
        ok: boolean;
        result?: unknown;
        error?: string;
      }[];
    };
  }>("/api/probe", { method: "POST", body: "{}" });
  const lines = data.report.results.map((r) => {
    if (r.ok) return `${r.id}: ${JSON.stringify(r.result)}`;
    return `${r.id}: FAIL ${r.error}`;
  });
  setStatus(
    `probe written to types/generated-probe.json\n${lines.join("\n")}`,
  );
}

function busy(on: boolean) {
  for (const b of [
    el.save,
    el.build,
    el.deploy,
    el.deployMenuBtn,
    el.probe,
  ]) {
    b.disabled = on;
  }
  if (on) setMenuOpen(false);
}

async function withBusy(fn: () => Promise<void>) {
  busy(true);
  try {
    await fn();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    busy(false);
  }
}

async function main() {
  view = new EditorView({
    state: EditorState.create({
      doc: "// loading…\n",
      extensions: [
        basicSetup,
        javascript({ typescript: true }),
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { height: "100%", width: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
      ],
    }),
    parent: el.editor,
  });

  syncDeployLabel();

  try {
    const cfg = await api<{
      config: {
        deviceIp: string;
        scriptId: number;
        host: string;
        port: number;
        compiler: string;
      };
    }>("/api/config");
    const c = cfg.config;
    el.configLine.textContent = `${c.deviceIp} · script ${c.scriptId} · ${c.host}:${c.port} · ${c.compiler}`;
  } catch {
    el.configLine.textContent = "config unavailable";
  }

  el.save.addEventListener("click", () => withBusy(saveScript));
  el.build.addEventListener("click", () => withBusy(buildScript));
  el.deploy.addEventListener("click", () => withBusy(() => deployScript()));
  el.probe.addEventListener("click", () => withBusy(probeDevice));
  el.ecoToggle.addEventListener("change", () => void toggleEco());

  el.deployMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setMenuOpen(el.deployMenu.hidden);
  });

  el.deployMenu.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button[data-mode]");
    if (!(btn instanceof HTMLButtonElement)) return;
    const mode = btn.dataset.mode === "prod" ? "prod" : "debug";
    const minify = btn.dataset.minify === "raw" ? "raw" : "min";
    deployChoice = { mode, minify };
    syncDeployLabel();
    setMenuOpen(false);
    withBusy(() => deployScript(deployChoice));
  });

  document.addEventListener("click", (e) => {
    if (!el.deploySplit.contains(e.target as Node)) setMenuOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setMenuOpen(false);
  });

  startDevicePoll();
  try {
    const data = await api<{ stats: ScriptStats }>("/api/stats");
    renderStats(data.stats);
  } catch {
    /* ignore until first build */
  }
  await loadHistory();
  await withBusy(loadScript);
}

main();
