import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { createDevicePanel, type DeviceIdentity } from "./device-panel";
import { createCollapsible } from "./collapsible";
import { createLayout } from "./layout";
import { createArtifactView, readOnlyCompartment } from "./artifact-view";
import { findingGutter } from "./finding-gutter";
import { statLineHighlight } from "./line-highlight";
import { diffHighlight } from "./diff";
import { dirtyGutter, setDirtyBaseline } from "./dirty-gutter";
import { shellyHover } from "./hover-docs";
import { buildErrorGutter, clearBuildErrors, reportBuildFailure } from "./build-error-gutter";
import { createDeployGate } from "./deploy-gate";
import { createHeaderLine } from "./header-line";
import { createDashboard } from "./dashboard";
import { closeAllMenus, createSplitButton } from "./split-button";
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
import { el } from "./dom-refs";
import { api } from "./api";
import {
  closeProbeLog,
  renderProbeLog,
  setProbeProgress,
  wireProbeLogToggle,
} from "./probe-panel";

type Mode = "debug" | "prod";
type Minify = "min" | "raw";
type BuildAction = "build" | "check" | "both";

let deployChoice: { mode: Mode; minify: Minify } = {
  mode: "debug",
  minify: "min",
};

/** What the primary Build button runs — the last variant picked from its menu. */
let buildAction: BuildAction = "both";

const deployGate = createDeployGate();

const BUILD_LABEL: Record<BuildAction, string> = {
  build: "Build",
  check: "Check",
  both: "Build + Check",
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
  const base = `Upload ${file} (${mode}, ${minifyLabel(minify)}) to the Shelly script slot over WebSocket RPC`;
  el.deploy.title = deployGate.ready() ? base : `${base} — disabled until Build + Check succeed`;
}

function syncBuildLabel() {
  const item = el.buildMenu.querySelector<HTMLButtonElement>(
    `button[data-action="${buildAction}"]`,
  );
  el.buildLabel.textContent = BUILD_LABEL[buildAction];
  if (item?.title) el.build.title = item.title;
}

async function runBuildAction(action = buildAction) {
  el.build.classList.add("running");
  try {
    if (action === "check") return await checkScript();
    await buildScript();
    if (action === "both") await checkScript();
  } finally {
    el.build.classList.remove("running");
  }
}

function setStatus(msg: string, isError = false) {
  el.status.textContent = msg;
  el.status.classList.toggle("error", isError);
}

type Sizes = { raw?: number; min?: number; adv?: number };

/** `adv` is absent whenever the tier-3 minifier is unavailable. */
function formatSizes(pair: Sizes | undefined): string {
  if (!pair) return "—";
  const parts: string[] = [];
  if (pair.raw != null) parts.push(`raw ${pair.raw} B`);
  if (pair.min != null) parts.push(`min ${pair.min} B`);
  if (pair.adv != null) parts.push(`adv ${pair.adv} B`);
  return parts.length ? parts.join(" · ") : "—";
}

async function toggleScriptRun(running: boolean) {
  setStatus(running ? "starting script…" : "stopping script…");
  const data = await api<{ running: boolean | null; scriptId: number }>(
    "/api/device/script",
    { method: "POST", body: JSON.stringify({ running }) },
  );
  const state = data.running === null ? "unknown" : data.running ? "running" : "stopped";
  setStatus(`script ${data.scriptId} ${state}`, data.running !== running);
  void device.refresh();
}

const header = createHeaderLine((running) => {
  void withBusy(() => toggleScriptRun(running));
});

/** Drives whether Check refreshes the device profile — see checkScript(). */
let deviceOnline = false;

function onDeviceIdentity(id: DeviceIdentity) {
  deviceOnline = id.state !== "offline";
  header.sync(id);
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
  copyFindings: el.copyFindings,
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
let artifacts: ReturnType<typeof createArtifactView>;

async function loadScript() {
  const data = await api<{ source: string }>("/api/script");
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: data.source },
  });
  setDirtyBaseline(view, data.source);
  setStatus("loaded scripts/main.ts");
}

const AUTO_KEY = "shelly-devroom.autoBuildCheck";
let autoTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAuto() {
  if (!el.autoBuildCheck.checked) return;
  if (artifacts?.previewing()) return;
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    void withBusy(async () => {
      await saveScript();
      await runBuildAction();
    });
  }, 3000);
}

async function saveScript() {
  const source = view.state.doc.toString();
  await api("/api/script", {
    method: "PUT",
    body: JSON.stringify({ source }),
  });
  setDirtyBaseline(view, source);
  setStatus(`saved (${new TextEncoder().encode(source).length} B)`);
}

async function buildScript() {
  setStatus("building…"); clearBuildErrors(view); deployGate.setBuildOk(false);
  const data = await api<{
    sizes: { debug: Sizes; prod: Sizes };
    stats?: ScriptStats;
    estimate?: MemoryEstimate;
    minFirmware?: MinFirmware | null;
    dialect?: { file: string; findings: Finding[] }[];
  }>("/api/build", { method: "POST", body: "{}" }).catch((e) => reportBuildFailure(view, e));
  el.sizeDebug.textContent = formatSizes(data.sizes.debug);
  el.sizeProd.textContent = formatSizes(data.sizes.prod);
  dashboard.update({ estimate: data.estimate ?? null, minFirmware: data.minFirmware ?? null });
  await loadHistory(data.stats ?? null);
  await artifacts?.refresh();
  const dialect =
    data.dialect?.flatMap((r) =>
      r.findings.map((f) => ({ ...f, file: `dist/${r.file}` })),
    ) ?? [];
  if (dialect.length) {
    const dialectErrors = dialect.some((f) => f.severity === "error");
    renderFindings(checkEls, dialect);
    deployGate.setBuildOk(!dialectErrors);
    setStatus("build ok — dialect guard reported findings (see check panel)", dialectErrors);
    return;
  }
  deployGate.setBuildOk(true);
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
  deployGate.setCheckOk(report.ok);
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
  el.probeProgress.hidden = false;
  setProbeProgress(0, 0, setStatus);
  const poll = setInterval(() => {
    void api<{ done: number; total: number }>("/api/probe/progress")
      .then((p) => setProbeProgress(p.done, p.total, setStatus))
      .catch(() => {});
  }, 300);
  try {
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
    renderProbeLog(report.scriptId, report.strategy, report.results);
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
  } finally {
    clearInterval(poll);
    el.probeProgress.hidden = true;
  }
}

function busy(on: boolean) {
  for (const b of [el.save, el.build, el.buildMenuBtn, el.deploy, el.deployMenuBtn, el.probe, el.probeLogToggle]) {
    const gated = (b === el.deploy || b === el.deployMenuBtn) && !deployGate.ready();
    b.disabled = on || (b === el.save && artifacts?.previewing() === true) || gated;
  }
  if (on) {
    closeAllMenus();
    closeProbeLog();
  }
  else syncDeployLabel();
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
        readOnlyCompartment.of([]),
        findingGutter,
        dirtyGutter,
        statLineHighlight,
        diffHighlight,
        shellyHover, buildErrorGutter,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) scheduleAuto();
        }),
        EditorView.theme({
          "&": { height: "100%", width: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
      ],
    }),
    parent: el.editor,
  });

  el.autoBuildCheck.checked = localStorage.getItem(AUTO_KEY) === "1";
  el.autoBuildCheck.addEventListener("change", () => {
    localStorage.setItem(AUTO_KEY, el.autoBuildCheck.checked ? "1" : "0");
    if (!el.autoBuildCheck.checked && autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
  });

  createLayout(() => view.requestMeasure());

  syncDeployLabel();
  syncBuildLabel();

  try {
    const cfg = await api<{
      config: { deviceIp: string; scriptId: number };
    }>("/api/config");
    const c = cfg.config;
    header.setConfig(c.deviceIp, c.scriptId);
  } catch {
    header.fail("config unavailable");
  }

  el.save.addEventListener("click", () => withBusy(saveScript));
  el.build.addEventListener("click", () => withBusy(() => runBuildAction()));
  el.deploy.addEventListener("click", () => withBusy(() => deployScript()));
  el.probe.addEventListener("click", () => withBusy(probeDevice));
  wireProbeLogToggle();

  createSplitButton(
    { root: el.buildSplit, toggle: el.buildMenuBtn, menu: el.buildMenu },
    (item) => {
      buildAction = (item.dataset.action as BuildAction | undefined) ?? "build";
      syncBuildLabel();
      withBusy(() => runBuildAction());
    },
  );

  createSplitButton(
    { root: el.deploySplit, toggle: el.deployMenuBtn, menu: el.deployMenu },
    (item) => {
      deployChoice = {
        mode: item.dataset.mode === "prod" ? "prod" : "debug",
        minify: item.dataset.minify === "raw" ? "raw" : "min",
      };
      syncDeployLabel();
      withBusy(() => deployScript(deployChoice));
    },
  );
  device.startPoll();
  await loadCheckCatalog();
  await loadHistory(await dashboard.loadStats());
  await withBusy(loadScript);
  // Only offer the preview once the editable buffer holds the real source.
  const onPreview = () => busy(false);
  artifacts = createArtifactView({ view, api, onStatus: setStatus, onPreview });
  // Fill the indicator with real verdicts without hijacking the status line.
  void checkScript({ quiet: true }).then(() => busy(false), () => {
    el.checkNote.textContent = "check could not run — press Check for the error";
  });
}

main();
