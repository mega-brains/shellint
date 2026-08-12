import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { EditorView } from "codemirror";
import { Header } from "./header";
import { Toolbar, type BuildAction, type Minify, type Mode } from "./toolbar";
import { Layout } from "./layout";
import { EditorHost } from "./editor-host";
import { BuildPanel, loadStats, type DashboardPatch } from "./dashboard";
import { CheckPanel, summarize, type CheckCatalog, type CheckReport, type Finding } from "./check-panel";
import { DevicePanel, type DeviceIdentity } from "./device-panel";
import { LogsPanel } from "./logs-panel";
import { api } from "./api";
import { createDeployGate } from "./deploy-gate";
import { setDirtyBaseline } from "./dirty-gutter";
import {
  clearBuildErrors,
  reportBuildFailure,
} from "./build-error-gutter";
import { probeNote, type ProbeResult } from "./probe-logic";
import { closeAllMenus } from "./split-button";
import { formatSizes, type Sizes } from "./sizes";

const AUTO_KEY = "shelly-devroom.autoBuildCheck";

export function App() {
  const [status, setStatusMsg] = useState("ready");
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [buildRunning, setBuildRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [deployReady, setDeployReady] = useState(false);
  const [buildAction, setBuildAction] = useState<BuildAction>("both");
  const [deployChoice, setDeployChoice] = useState<{
    mode: Mode;
    minify: Minify;
  }>({ mode: "debug", minify: "min" });
  const [autoBuildCheck, setAutoBuildCheck] = useState(
    () => localStorage.getItem(AUTO_KEY) === "1",
  );
  const [deviceIp, setDeviceIp] = useState("");
  const [configBase, setConfigBase] = useState("");
  const [configFail, setConfigFail] = useState<string | undefined>();
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [deviceMeta, setDeviceMeta] = useState("—");
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [sizeDebug, setSizeDebug] = useState("—");
  const [sizeProd, setSizeProd] = useState("—");
  const [dash, setDash] = useState<DashboardPatch>({ history: [] });
  const [catalog, setCatalog] = useState<CheckCatalog | null>(null);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [dialectFindings, setDialectFindings] = useState<Finding[] | null>(
    null,
  );
  const [probeResults, setProbeResults] = useState<ProbeResult[] | null>(null);
  const [probeNoteText, setProbeNoteText] = useState("not run yet");
  const [probeProgress, setProbeProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const viewRef = useRef<EditorView | null>(null);
  const artifactsRef = useRef<{
    refresh: () => Promise<void>;
    previewing: () => boolean;
  } | null>(null);
  const deviceRef = useRef<{ refresh: () => Promise<void> } | null>(null);
  const deployGate = useRef(createDeployGate()).current;
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoOn = useRef(autoBuildCheck);
  autoOn.current = autoBuildCheck;

  const setStatus = useCallback((msg: string, isError = false) => {
    setStatusMsg(msg);
    setStatusError(isError);
  }, []);

  const syncDeployReady = useCallback(() => {
    setDeployReady(deployGate.ready());
  }, [deployGate]);

  const withBusy = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      closeAllMenus();
      try {
        await fn();
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e), true);
      } finally {
        setBusy(false);
        syncDeployReady();
      }
    },
    [setStatus, syncDeployReady],
  );

  const saveScript = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const source = view.state.doc.toString();
    await api("/api/script", {
      method: "PUT",
      body: JSON.stringify({ source }),
    });
    setDirtyBaseline(view, source);
    setStatus(`saved (${new TextEncoder().encode(source).length} B)`);
  }, [setStatus]);

  const checkScript = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) {
        setStatus(
          deviceOnline ? "checking (with device)…" : "checking…",
        );
      }
      const data = await api<{ report: CheckReport }>("/api/check", {
        method: "POST",
        body: JSON.stringify({ connected: deviceOnline }),
      });
      setReport(data.report);
      setDialectFindings(null);
      deployGate.setCheckOk(data.report.ok);
      syncDeployReady();
      if (quiet) return;
      const scope = data.report.artifacts.length
        ? `scripts/main.ts + ${data.report.artifacts.join(", ")}`
        : "scripts/main.ts (no build artifacts)";
      const p = data.report.profile;
      const device = p
        ? ` · device ${p.model ?? p.deviceIp} fw ${p.ver ?? "?"} (${p.source})`
        : " · no device profile";
      setStatus(
        `check ${summarize(data.report.counts)} · ${scope}${device}`,
        !data.report.ok,
      );
    },
    [deviceOnline, deployGate, setStatus, syncDeployReady],
  );

  const buildScript = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    setStatus("building…");
    clearBuildErrors(view);
    deployGate.setBuildOk(false);
    syncDeployReady();
    const data = await api<{
      sizes: { debug: Sizes; prod: Sizes };
      stats?: DashboardPatch["stats"];
      estimate?: DashboardPatch["estimate"];
      minFirmware?: DashboardPatch["minFirmware"];
      dialect?: { file: string; findings: Finding[] }[];
    }>("/api/build", { method: "POST", body: "{}" }).catch((e) =>
      reportBuildFailure(view, e),
    );
    setSizeDebug(formatSizes(data.sizes.debug));
    setSizeProd(formatSizes(data.sizes.prod));
    setDash((prev) => ({
      ...prev,
      estimate: data.estimate ?? null,
      minFirmware: data.minFirmware ?? null,
      stats: data.stats ?? prev.stats,
    }));
    try {
      const hist = await api<{ history: DashboardPatch["history"] }>(
        "/api/history?limit=40",
      );
      setDash((prev) => ({
        ...prev,
        history: hist.history,
        stats: data.stats ?? prev.stats,
      }));
      const latest = hist.history?.[0];
      if (latest) {
        setSizeDebug((cur) =>
          cur === "—" ? formatSizes(latest.sizes.debug) : cur,
        );
        setSizeProd((cur) =>
          cur === "—" ? formatSizes(latest.sizes.prod) : cur,
        );
      }
    } catch {
      setDash((prev) => ({ ...prev, history: [] }));
    }
    await artifactsRef.current?.refresh();
    const dialect =
      data.dialect?.flatMap((r) =>
        r.findings.map((f) => ({ ...f, file: `dist/${r.file}` })),
      ) ?? [];
    if (dialect.length) {
      const dialectErrors = dialect.some((f) => f.severity === "error");
      setDialectFindings(dialect);
      setReport(null);
      deployGate.setBuildOk(!dialectErrors);
      syncDeployReady();
      setStatus(
        "build ok — dialect guard reported findings (see check panel)",
        dialectErrors,
      );
      return;
    }
    deployGate.setBuildOk(true);
    syncDeployReady();
    setStatus("build ok");
  }, [deployGate, setStatus, syncDeployReady]);

  const runBuildAction = useCallback(
    async (action = buildAction) => {
      setBuildRunning(true);
      try {
        if (action === "check") return await checkScript();
        await buildScript();
        if (action === "both") await checkScript();
      } finally {
        setBuildRunning(false);
      }
    },
    [buildAction, buildScript, checkScript],
  );

  const deployScript = useCallback(
    async (choice = deployChoice) => {
      const { mode, minify } = choice;
      const label = minify === "raw" ? "non-minified" : "minified";
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
      void deviceRef.current?.refresh();
    },
    [deployChoice, setStatus],
  );

  const probeDevice = useCallback(async () => {
    setProbeProgress({ done: 0, total: 0 });
    setStatus("probing…");
    const poll = setInterval(() => {
      void api<{ done: number; total: number }>("/api/probe/progress")
        .then((p) => {
          setProbeProgress({ done: p.done, total: p.total });
          const pct =
            p.total > 0
              ? Math.min(100, Math.round((p.done / p.total) * 100))
              : 0;
          setStatus(
            p.total > 0
              ? `probing… ${p.done}/${p.total} (${pct}%)`
              : "probing…",
          );
        })
        .catch(() => {});
    }, 300);
    try {
      const data = await api<{
        report: {
          scriptId: number;
          strategy: string;
          notes?: string[];
          results: ProbeResult[];
        };
      }>("/api/probe", { method: "POST", body: "{}" });
      const report = data.report;
      setProbeResults(report.results);
      setProbeNoteText(
        probeNote(report.scriptId, report.strategy, report.results),
      );
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
      setProbeProgress(null);
    }
  }, [setStatus]);

  const scheduleAuto = useCallback(() => {
    if (!autoOn.current) return;
    if (artifactsRef.current?.previewing()) return;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null;
      void withBusy(async () => {
        await saveScript();
        await runBuildAction();
      });
    }, 3000);
  }, [withBusy, saveScript, runBuildAction]);

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await api<{
          config: { deviceIp: string; scriptId: number };
        }>("/api/config");
        setDeviceIp(cfg.config.deviceIp);
        setConfigBase(`script ${cfg.config.scriptId}`);
      } catch {
        setConfigFail("config unavailable");
      }
      try {
        const data = await api<CheckCatalog>("/api/checks");
        setCatalog({ groups: data.groups, checks: data.checks });
      } catch {
        /* check panel shows unavailable via note when catalog null */
      }
      const stats = await loadStats();
      setDash((prev) => ({
        ...prev,
        estimate: stats.estimate,
        minFirmware: stats.minFirmware,
      }));
      try {
        const hist = await api<{ history: NonNullable<DashboardPatch["history"]> }>(
          "/api/history?limit=40",
        );
        setDash((prev) => ({
          ...prev,
          history: hist.history,
          stats: stats.stats,
        }));
        const latest = hist.history[0];
        if (latest) {
          setSizeDebug(formatSizes(latest.sizes.debug));
          setSizeProd(formatSizes(latest.sizes.prod));
        }
      } catch {
        setDash((prev) => ({ ...prev, history: [], stats: stats.stats }));
      }
    })();
  }, []);

  const onView = useCallback(
    (view: EditorView) => {
      viewRef.current = view;
      void withBusy(async () => {
        const data = await api<{ source: string }>("/api/script");
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: data.source,
          },
        });
        setDirtyBaseline(view, data.source);
        setStatus("loaded scripts/main.ts");
      }).then(() => {
        void checkScript({ quiet: true }).catch(() => {
          /* check note stays until user runs Check */
        });
      });
    },
    [withBusy, setStatus, checkScript],
  );

  return (
    <>
      <Header
        deviceIp={deviceIp}
        configBase={configBase}
        configFail={configFail}
        identity={identity}
        onToggleRun={(running) =>
          void withBusy(async () => {
            setStatus(running ? "starting script…" : "stopping script…");
            const data = await api<{
              running: boolean | null;
              scriptId: number;
            }>("/api/device/script", {
              method: "POST",
              body: JSON.stringify({ running }),
            });
            const state =
              data.running === null
                ? "unknown"
                : data.running
                  ? "running"
                  : "stopped";
            setStatus(
              `script ${data.scriptId} ${state}`,
              data.running !== running,
            );
            void deviceRef.current?.refresh();
          })
        }
        status={status}
        statusError={statusError}
        probeProgress={probeProgress}
        deviceMeta={deviceMeta}
      >
        <Toolbar
          busy={busy}
          previewing={previewing}
          deployReady={deployReady}
          buildAction={buildAction}
          buildRunning={buildRunning}
          deployChoice={deployChoice}
          autoBuildCheck={autoBuildCheck}
          onAutoChange={(on) => {
            setAutoBuildCheck(on);
            localStorage.setItem(AUTO_KEY, on ? "1" : "0");
            if (!on && autoTimer.current) {
              clearTimeout(autoTimer.current);
              autoTimer.current = null;
            }
          }}
          onSave={() => void withBusy(saveScript)}
          onBuild={() => void withBusy(() => runBuildAction())}
          onBuildPick={(action) => {
            setBuildAction(action);
            void withBusy(() => runBuildAction(action));
          }}
          onDeploy={() => void withBusy(() => deployScript())}
          onDeployPick={(choice) => {
            setDeployChoice(choice);
            void withBusy(() => deployScript(choice));
          }}
          onProbe={() => void withBusy(probeDevice)}
          probeResults={probeResults}
          probeNote={probeNoteText}
        />
      </Header>

      <Layout
        onResize={() => viewRef.current?.requestMeasure()}
        editor={
          <EditorHost
            onView={onView}
            onDocChange={scheduleAuto}
            onStatus={setStatus}
            onPreview={(p) => {
              setPreviewing(p);
              syncDeployReady();
            }}
            onArtifactsReady={(a) => {
              artifactsRef.current = a;
            }}
          />
        }
        side={
          <>
            <BuildPanel
              sizeDebug={sizeDebug}
              sizeProd={sizeProd}
              patch={dash}
            />
            <CheckPanel
              catalog={catalog}
              report={report}
              dialectFindings={dialectFindings}
            />
          </>
        }
        footer={
          <>
            <DevicePanel
              api={api}
              onStatus={setStatus}
              onIdentity={(id) => {
                setIdentity(id);
                setDeviceOnline(id.state !== "offline");
                setDash((prev) => ({ ...prev, memPeak: id.memPeak }));
              }}
              onMeta={setDeviceMeta}
              onReady={(ctl) => {
                deviceRef.current = ctl;
              }}
            />
            <LogsPanel api={api} onStatus={setStatus} />
          </>
        }
      />
    </>
  );
}
