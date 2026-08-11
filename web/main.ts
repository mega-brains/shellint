import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { createDevicePanel, type DeviceIdentity } from "./device-panel";
import { createCollapsible } from "./collapsible";
import { createSplitter } from "./splitter";
import { createDashboard } from "./dashboard";
import {
  type HistoryRow,
  type MemoryEstimate,
  type MinFirmware,
  type ScriptStats,
} from "./stats-panel";
import {
  renderCatalog,
  renderFindings,
  renderReport,
  summarize,
  type CheckCatalog,
  type CheckReport,
  type Finding,
} from "./check-panel";

type Mode = "debug" | "prod";
type Minify = "min" | "raw";

const el = {
  editor: document.getElementById("editor")!,
  save: document.getElementById("btnSave") as HTMLButtonElement,
  build: document.getElementById("btnBuild") as HTMLButtonElement,
  deploy: document.getElementById("btnDeploy") as HTMLButtonElement,
  deployMenuBtn: document.getElementById("btnDeployMenu") as HTMLButtonElement,
  deployMenu: document.getElementById("deployMenu") as HTMLUListElement,
  deploySplit: document.getElementById("deploySplit") as HTMLDivElement,
  check: document.getElementById("btnCheck") as HTMLButtonElement,
  probe: document.getElementById("btnProbe") as HTMLButtonElement,
  checkPanel: document.getElementById("checkPanel")!,
  checkHead: document.getElementById("checkHead")!,
  checkToggle: document.getElementById("checkToggle")!,
  checkPeek: document.getElementById("checkPeek")!,
  checkNote: document.getElementById("checkNote")!,
  checkRules: document.getElementById("checkRules")!,
  findingsList: document.getElementById("findingsList")!,
  status: document.getElementById("statusLine")!,
  workspace: document.getElementById("workspace")!,
  side: document.getElementById("side")!,
  splitter: document.getElementById("workspaceSplitter")!,
  buildPanel: document.getElementById("buildPanel")!,
  buildHead: document.getElementById("buildHead")!,
  buildToggle: document.getElementById("buildToggle")!,
  sizeDebug: document.getElementById("sizeDebug")!,
  sizeProd: document.getElementById("sizeProd")!,
  configLine: document.getElementById("configLine")!,
  devicePanel: document.getElementById("devicePanel")!,
  deviceHead: document.getElementById("deviceHead")!,
  deviceToggle: document.getElementById("deviceToggle")!,
  devicePeek: document.getElementById("devicePeek")!,
  deviceBody: document.getElementById("deviceBody")!,
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
  gMem: document.getElementById("gMem")!,
  gCpu: document.getElementById("gCpu")!,
  gRam: document.getElementById("gRam")!,
  gFs: document.getElementById("gFs")!,
  gRssi: document.getElementById("gRssi")!,
};

let deployChoice: { mode: Mode; minify: Minify } = {
  mode: "debug",
  minify: "min",
};

function minifyLabel(m: Minify): string {
  return m === "raw" ? "non-minified" : "minified";
}

function shortMinify(m: Minify): string {
  return m === "raw" ? "raw" : "min";
}

function syncDeployLabel() {
  const { mode, minify } = deployChoice;
  const file = minify === "raw" ? `dist/${mode}.raw.js` : `dist/${mode}.js`;
  el.deploy.textContent = `Deploy ${mode} · ${shortMinify(minify)}`;
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

const MAX_SCRIPT_NAME = 28;

let configBase = "";

/** Header = static config, plus whatever the last poll learned about the device. */
function syncConfigLine(id?: DeviceIdentity) {
  if (!configBase) return;
  if (!id) {
    el.configLine.textContent = configBase;
    return;
  }
  const name =
    id.scriptName && id.scriptName.length > MAX_SCRIPT_NAME
      ? `${id.scriptName.slice(0, MAX_SCRIPT_NAME - 1)}…`
      : id.scriptName;
  const parts = [
    id.deviceName,
    name ? `“${name}”` : null,
    id.state === "unknown" ? null : id.state,
  ].filter(Boolean);
  el.configLine.textContent = parts.length
    ? `${configBase} · ${parts.join(" · ")}`
    : configBase;
  el.configLine.classList.toggle(
    "warn",
    id.state === "offline" || id.state === "stopped",
  );
}

/** Drives whether Check refreshes the device profile — see checkScript(). */
let deviceOnline = false;

function onDeviceIdentity(id: DeviceIdentity) {
  deviceOnline = id.state !== "offline";
  syncConfigLine(id);
  dashboard.update({ memPeak: id.memPeak });
}

const dashboard = createDashboard({ api, onStatus: setStatus });

const device = createDevicePanel(
  {
    panel: el.devicePanel,
    head: el.deviceHead,
    toggle: el.deviceToggle,
    peek: el.devicePeek,
    body: el.deviceBody,
    meta: el.deviceMeta,
    err: el.deviceErr,
    ecoToggle: el.ecoToggle,
    dRunning: el.dRunning,
    dMem: el.dMem,
    dCpu: el.dCpu,
    dRam: el.dRam,
    dFs: el.dFs,
    dLatency: el.dLatency,
    dTemp: el.dTemp,
    dRssi: el.dRssi,
    gMem: el.gMem,
    gCpu: el.gCpu,
    gRam: el.gRam,
    gFs: el.gFs,
    gRssi: el.gRssi,
  },
  api,
  setStatus,
  onDeviceIdentity,
);

const checkEls = {
  peek: el.checkPeek,
  note: el.checkNote,
  findings: el.findingsList,
  rules: el.checkRules,
};

/** Group labels and rule descriptions, fetched once so the panel is never blank. */
let checkCatalog: CheckCatalog | null = null;

createCollapsible(
  { panel: el.buildPanel, head: el.buildHead, toggle: el.buildToggle },
  {
    storageKey: "shelly-devroom.buildPanel.collapsed",
    defaultCollapsed: false,
  },
);

createCollapsible(
  { panel: el.checkPanel, head: el.checkHead, toggle: el.checkToggle },
  {
    storageKey: "shelly-devroom.checkPanel.collapsed",
    defaultCollapsed: true,
  },
);

async function loadCheckCatalog() {
  try {
    const data = await api<CheckCatalog>("/api/checks");
    checkCatalog = { groups: data.groups, checks: data.checks };
    renderCatalog(checkEls, checkCatalog);
  } catch {
    el.checkNote.textContent = "check catalog unavailable";
  }
}

/** After a reload the size blocks are empty until a build; history has them. */
function seedSizesFromHistory(history: HistoryRow[]) {
  const latest = history[0];
  if (!latest) return;
  if (el.sizeDebug.textContent === "—") {
    el.sizeDebug.textContent = formatSizes(latest.sizes.debug);
  }
  if (el.sizeProd.textContent === "—") {
    el.sizeProd.textContent = formatSizes(latest.sizes.prod);
  }
}

async function loadHistory(stats?: ScriptStats | null) {
  try {
    const data = await api<{ history: HistoryRow[] }>("/api/history?limit=40");
    dashboard.update({ stats, history: data.history });
    seedSizesFromHistory(data.history);
  } catch {
    dashboard.update({ stats, history: [] });
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
    estimate?: MemoryEstimate;
    minFirmware?: MinFirmware | null;
    dialect?: { file: string; findings: Finding[] }[];
  }>("/api/build", { method: "POST", body: "{}" });
  el.sizeDebug.textContent = formatSizes(data.sizes.debug);
  el.sizeProd.textContent = formatSizes(data.sizes.prod);
  dashboard.update({
    estimate: data.estimate ?? null,
    minFirmware: data.minFirmware ?? null,
  });
  await loadHistory(data.stats ?? null);
  const dialect =
    data.dialect?.flatMap((r) =>
      r.findings.map((f) => ({ ...f, file: `dist/${r.file}` })),
    ) ?? [];
  if (dialect.length) {
    renderFindings(checkEls, dialect);
    setStatus("build ok — dialect guard reported findings (see check panel)", true);
    return;
  }
  setStatus("build ok");
}

async function checkScript({ quiet = false } = {}) {
  // Only ask for a live profile when polling says the device answers, so an
  // offline Check never stalls on an RPC timeout.
  if (!quiet) setStatus(deviceOnline ? "checking (with device)…" : "checking…");
  const data = await api<{ report: CheckReport }>("/api/check", {
    method: "POST",
    body: JSON.stringify({ connected: deviceOnline }),
  });
  const { report } = data;
  renderReport(checkEls, report, checkCatalog);
  if (quiet) return;
  const scope = report.artifacts.length
    ? `scripts/main.ts + ${report.artifacts.join(", ")}`
    : "scripts/main.ts (no build artifacts)";
  const p = report.profile;
  const device = p
    ? ` · device ${p.model ?? p.deviceIp} fw ${p.ver ?? "?"} (${p.source})`
    : " · no device profile";
  setStatus(`check ${summarize(report.counts)} · ${scope}${device}`, !report.ok);
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
  void device.refresh();
}

async function probeDevice() {
  setStatus("probing…");
  const data = await api<{
    report: {
      scriptId: number;
      strategy: string;
      notes?: string[];
      results: {
        id: string;
        ok: boolean;
        result?: unknown;
        error?: string;
      }[];
    };
  }>("/api/probe", { method: "POST", body: "{}" });
  const report = data.report;
  const lines = report.results.map((r) =>
    r.ok
      ? `${r.id}: ${JSON.stringify(r.result)}`
      : `${r.id}: FAIL ${r.error}`,
  );
  setStatus(
    [
      `probe written to types/generated-probe.json · slot ${report.scriptId} (${report.strategy})`,
      ...(report.notes ?? []),
      ...lines,
    ].join("\n"),
  );
}

function busy(on: boolean) {
  for (const b of [
    el.save,
    el.build,
    el.deploy,
    el.deployMenuBtn,
    el.check,
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

  createSplitter(
    { root: el.workspace, handle: el.splitter, panel: el.side },
    {
      storageKey: "shelly-devroom.side.width",
      cssVar: "--side-w",
      minPanel: 168,
      minEditor: 320,
      onResize: () => view.requestMeasure(),
    },
  );

  syncDeployLabel();

  try {
    const cfg = await api<{
      config: {
        deviceIp: string;
        scriptId: number;
        compiler: string;
      };
    }>("/api/config");
    const c = cfg.config;
    configBase = `${c.deviceIp} · script ${c.scriptId} · ${c.compiler}`;
    syncConfigLine();
  } catch {
    el.configLine.textContent = "config unavailable";
  }

  el.save.addEventListener("click", () => withBusy(saveScript));
  el.build.addEventListener("click", () => withBusy(buildScript));
  el.deploy.addEventListener("click", () => withBusy(() => deployScript()));
  el.check.addEventListener("click", () => withBusy(() => checkScript()));
  el.probe.addEventListener("click", () => withBusy(probeDevice));
  el.deployMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setMenuOpen(el.deployMenu.hidden);
  });
  el.deployMenu.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button[data-mode]");
    if (!(btn instanceof HTMLButtonElement)) return;
    deployChoice = {
      mode: btn.dataset.mode === "prod" ? "prod" : "debug",
      minify: btn.dataset.minify === "raw" ? "raw" : "min",
    };
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
  device.startPoll();
  await loadCheckCatalog();
  await loadHistory(await dashboard.loadStats());
  await withBusy(loadScript);
  // Fill the indicator with real verdicts without hijacking the status line.
  void checkScript({ quiet: true }).catch(() => {
    el.checkNote.textContent = "check could not run — press Check for the error";
  });
}

main();
