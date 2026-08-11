import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { createDevicePanel } from "./device-panel";
import {
  updateStatsPanel,
  type HistoryRow,
  type ScriptStats,
} from "./stats-panel";

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
  probe: document.getElementById("btnProbe") as HTMLButtonElement,
  status: document.getElementById("statusLine")!,
  sizeDebug: document.getElementById("sizeDebug")!,
  sizeProd: document.getElementById("sizeProd")!,
  scriptStats: document.getElementById("scriptStats")!,
  statsChart: document.getElementById("statsChart")!,
  buildHistory: document.getElementById("buildHistory")!,
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
  },
  api,
  setStatus,
);

async function loadHistory(stats?: ScriptStats | null) {
  try {
    const data = await api<{ history: HistoryRow[] }>("/api/history?limit=40");
    updateStatsPanel({
      summaryEl: el.scriptStats,
      chartEl: el.statsChart,
      historyEl: el.buildHistory,
      stats,
      history: data.history,
    });
  } catch {
    updateStatsPanel({
      summaryEl: el.scriptStats,
      chartEl: el.statsChart,
      historyEl: el.buildHistory,
      stats,
      history: [],
    });
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
    dialect?: {
      file: string;
      findings: {
        severity: string;
        rule: string;
        message: string;
        line?: number;
      }[];
    }[];
  }>("/api/build", { method: "POST", body: "{}" });
  el.sizeDebug.textContent = formatSizes(data.sizes.debug);
  el.sizeProd.textContent = formatSizes(data.sizes.prod);
  await loadHistory(data.stats ?? null);
  const bad =
    data.dialect?.flatMap((r) =>
      r.findings.map(
        (f) =>
          `${f.severity} ${r.file}${f.line != null ? `:${f.line}` : ""} ${f.rule}: ${f.message}`,
      ),
    ) ?? [];
  if (bad.length) {
    setStatus(`build ok with dialect notes\n${bad.join("\n")}`, true);
    return;
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
      results: {
        id: string;
        ok: boolean;
        result?: unknown;
        error?: string;
      }[];
    };
  }>("/api/probe", { method: "POST", body: "{}" });
  const lines = data.report.results.map((r) =>
    r.ok
      ? `${r.id}: ${JSON.stringify(r.result)}`
      : `${r.id}: FAIL ${r.error}`,
  );
  setStatus(
    `probe written to types/generated-probe.json\n${lines.join("\n")}`,
  );
}

function busy(on: boolean) {
  for (const b of [el.save, el.build, el.deploy, el.deployMenuBtn, el.probe]) {
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
  try {
    const data = await api<{ stats: ScriptStats }>("/api/stats");
    await loadHistory(data.stats);
  } catch {
    await loadHistory();
  }
  await withBusy(loadScript);
}

main();
