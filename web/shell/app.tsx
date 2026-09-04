import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { EditorView } from "@codemirror/view";
import { Header } from "./header";
import { Toolbar, type BuildAction, type Minify, type Mode } from "./toolbar";
import { runBuildSequence, type BuildRunOptions } from "./build-action";
import { Layout } from "./layout";
import { Inspector, useInspectorTab } from "./inspector";
import { ReadinessRail } from "./readiness-rail";
import { deriveReadiness } from "./readiness";
import { EditorHost } from "../editor/editor-host";
import { BuildPanel, type DashboardPatch } from "../stats/dashboard";
import { CheckPanel, summarize, type CheckCatalog, type CheckReport, type Finding } from "../check/check-panel";
import { tally } from "../check/check-types";
import { OptionsPanel } from "./options-panel";
import { api, apiStream } from "../lib/api";
import { createDeployGate } from "../device/deploy-gate";
import { setDirtyBaseline } from "../editor/dirty-gutter";
import {
  clearBuildErrors,
  reportBuildFailure,
} from "../editor/build-error-gutter";
import { closeAllMenus } from "../ui/button";
import { isEmptySizes, type Sizes } from "../lib/sizes";
import { ScriptHistoryModal } from "../history/script-history-modal";
import { useScriptHistory } from "../history/use-script-history";
import { useInitialLoad } from "./use-initial-load";
import { useDeviceSection } from "./device-section";
import { StaticFileControls } from "./static-file-controls";
import { applyCheckFixes } from "../check/apply-check-fixes";
const AUTO_KEY = "shellint.autoBuildCheck";

export function App() {
  const [status, setStatusMsg] = useState("ready");
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [buildRunning, setBuildRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [deployReady, setDeployReady] = useState(false);
  /** null until the first build of this session; false when it failed. */
  const [buildOk, setBuildOk] = useState<boolean | null>(null);
  const [buildStale, setBuildStale] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [inspectorTab, setInspectorTab] = useInspectorTab();
  const [buildAction, setBuildAction] = useState<BuildAction>("both");
  const [skipTypeCheck, setSkipTypeCheck] = useState(false);
  const [deployChoice, setDeployChoice] = useState<{
    mode: Mode;
    minify: Minify;
  }>({ mode: "debug", minify: "min" });
  const [autoBuildCheck, setAutoBuildCheck] = useState(
    () => localStorage.getItem(AUTO_KEY) === "1",
  );
  const [deviceIp, setDeviceIp] = useState("");
  const [configFail, setConfigFail] = useState<string | undefined>();
  const [isStatic, setIsStatic] = useState<boolean | null>(null);
  const [sizeDebug, setSizeDebug] = useState<Sizes>({});
  const [sizeProd, setSizeProd] = useState<Sizes>({});
  const [dash, setDash] = useState<DashboardPatch>({ history: [] });
  const [catalog, setCatalog] = useState<CheckCatalog | null>(null);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [checkProgress, setCheckProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [dialectFindings, setDialectFindings] = useState<Finding[] | null>(
    null,
  );
  const viewRef = useRef<EditorView | null>(null);
  const artifactsRef = useRef<{
    refresh: () => Promise<void>;
    previewing: () => boolean;
  } | null>(null);
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

  // Owns everything that only makes sense with a real device on the LAN —
  // gated internally on `isStatic` (web/shell/device-section.tsx). Called
  // before checkScript below since its deps array reads deviceSection.deviceOnline.
  const deviceSection = useDeviceSection({
    isStatic,
    viewRef,
    setStatus,
    withBusy,
    busy,
    deployGate,
    syncDeployReady,
    deviceIp,
  });

  // Folded into the shared dashboard patch rather than read directly, since
  // BuildPanel already takes its `memPeak` from `dash`, not from device state.
  useEffect(() => {
    setDash((prev) => ({ ...prev, memPeak: deviceSection.memPeak }));
  }, [deviceSection.memPeak]);

  const checkScript = useCallback(
    async ({ quiet = false, showProgress = false } = {}) => {
      if (!quiet) {
        setStatus(
          deviceSection.deviceOnline ? "checking (with device)…" : "checking…",
        );
      }
      if (showProgress) setCheckProgress(null);
      try {
        const next = showProgress
          ? await apiStream<CheckReport>(
              "/api/check/stream",
              {
                method: "POST",
                body: JSON.stringify({ connected: deviceSection.deviceOnline, quiet }),
              },
              setCheckProgress,
            )
          : (
              await api<{ report: CheckReport }>("/api/check", {
                method: "POST",
                body: JSON.stringify({ connected: deviceSection.deviceOnline, quiet }),
              })
            ).report;
        setReport(next);
        setDialectFindings(null);
        setCheckFailed(!next.ok);
        deployGate.setCheckOk(next.ok);
        syncDeployReady();
        if (quiet) return;
        const scope = next.artifacts.length
          ? `scripts/main.ts + ${next.artifacts.join(", ")}`
          : "scripts/main.ts (no build artifacts)";
        const p = next.profile;
        const device = p
          ? ` · device ${p.model ?? p.deviceIp} fw ${p.ver ?? "?"} (${p.source})`
          : " · no device profile";
        setStatus(
          `check ${summarize(next.counts)} · ${scope}${device}`,
          !next.ok,
        );
      } finally {
        if (showProgress) setCheckProgress(null);
      }
    },
    [deviceSection.deviceOnline, deployGate, setStatus, syncDeployReady],
  );

  const checkScriptQuiet = useCallback(
    () => checkScript({ quiet: true }),
    [checkScript],
  );
  const scriptHistory = useScriptHistory(viewRef, setStatus, checkScriptQuiet);

  // Static build only (M17.6): a file opened via web/shell/static-file-controls.tsx
  // already updated the editor doc and persisted through /api/script — this just
  // runs the same bookkeeping onView does for the initial load.
  const handleFileOpened = useCallback(
    (source: string) => {
      const view = viewRef.current;
      if (view) setDirtyBaseline(view, source);
      scriptHistory.markSaved(source);
      void checkScriptQuiet().catch(() => {
        /* check note stays until user runs Check */
      });
    },
    [scriptHistory, checkScriptQuiet],
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
    scriptHistory.markSaved(source);
    deviceSection.clearImportedBuffer();
    setStatus(`saved (${new TextEncoder().encode(source).length} B)`);
  }, [setStatus, scriptHistory, deviceSection]);

  const buildScript = useCallback(async (skipTypes = false) => {
    const view = viewRef.current;
    if (!view) return;
    setStatus("building…");
    clearBuildErrors(view);
    setBuildOk(null);
    deployGate.setBuildOk(false);
    syncDeployReady();
    const data = await api<{
      sizes: { debug: Sizes; prod: Sizes };
      stats?: DashboardPatch["stats"];
      variants?: DashboardPatch["variants"];
      estimate?: DashboardPatch["estimate"];
      minFirmware?: DashboardPatch["minFirmware"];
      dialect?: { file: string; findings: Finding[] }[];
    }>("/api/build", {
      method: "POST",
      body: JSON.stringify({ skipTypeCheck: skipTypes }),
    }).catch((e) => {
      setBuildOk(false);
      return reportBuildFailure(view, e);
    });
    setSizeDebug(data.sizes.debug ?? {});
    setSizeProd(data.sizes.prod ?? {});
    let history: DashboardPatch["history"] | undefined;
    try {
      const hist = await api<{ history: DashboardPatch["history"] }>(
        "/api/history?limit=40",
      );
      history = hist.history;
      const latest = hist.history?.[0];
      if (latest) {
        setSizeDebug((cur) =>
          isEmptySizes(cur) ? (latest.sizes.debug ?? {}) : cur,
        );
        setSizeProd((cur) =>
          isEmptySizes(cur) ? (latest.sizes.prod ?? {}) : cur,
        );
      }
    } catch {
      history = [];
    }
    setDash((prev) => ({
      ...prev, estimate: data.estimate ?? null, minFirmware: data.minFirmware ?? null,
      stats: data.stats ?? prev.stats, variants: data.variants ?? prev.variants,
      ...(history !== undefined ? { history } : {}),
    }));
    await artifactsRef.current?.refresh();
    const dialect =
      data.dialect?.flatMap((r) =>
        r.findings.map((f) => ({ ...f, file: `dist/${r.file}` })),
      ) ?? [];
    if (dialect.length) {
      const dialectErrors = dialect.some((f) => f.severity === "error");
      setDialectFindings(dialect);
      setReport(null);
      setBuildOk(!dialectErrors);
      setBuildStale(false);
      setCheckFailed(dialectErrors);
      deployGate.setBuildOk(!dialectErrors);
      syncDeployReady();
      setStatus(
        "build ok — dialect guard reported findings (see check panel)",
        dialectErrors,
      );
      return;
    }
    setBuildOk(true);
    setBuildStale(false);
    deployGate.setBuildOk(true);
    syncDeployReady();
    setStatus("build ok");
  }, [deployGate, setStatus, syncDeployReady]);

  const runBuildAction = useCallback(
    async (opts: BuildRunOptions = {}) => {
      const {
        action = buildAction,
        skipTypes = skipTypeCheck,
        showCheckProgress = true,
      } = opts;
      setBuildRunning(true);
      try {
        await runBuildSequence(
          action,
          () => buildScript(skipTypes),
          () => checkScript({ showProgress: showCheckProgress }),
        );
      } finally {
        setBuildRunning(false);
      }
    },
    [buildAction, buildScript, checkScript, skipTypeCheck],
  );

  const scheduleAuto = useCallback(() => {
    setBuildStale(true);
    if (!autoOn.current) return;
    if (artifactsRef.current?.previewing()) return;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null;
      void withBusy(async () => {
        await saveScript();
        await runBuildAction({ showCheckProgress: false });
      });
    }, 3000);
  }, [withBusy, saveScript, runBuildAction]);

  useInitialLoad({ setDeviceIp, setConfigFail, setIsStatic, setCatalog, setDash, setSizeDebug, setSizeProd });

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
        scriptHistory.markSaved(data.source);
        setStatus("loaded scripts/main.ts");
      }).then(() => {
        void checkScript({ quiet: true }).catch(() => {
          /* check note stays until user runs Check */
        });
      });
    },
    [withBusy, setStatus, checkScript, scriptHistory],
  );

  const readiness = deriveReadiness({
    buildOk,
    buildStale,
    sizeProd,
    estimateBytes: dash.estimate?.bytes ?? null,
    report,
    dialectFindings,
    isStatic: isStatic === true,
    hasDevice: deviceSection.hasDevice,
    probeRequired: deviceSection.probeRequired,
    probeSkipped: deviceSection.probeSkipped,
    probeProgress: deviceSection.probeProgress,
    deployReady,
  });
  const checkCounts = report?.counts;

  return (
    <>
      <Header
        deviceIp={deviceSection.shownIp}
        configFail={configFail}
        identity={deviceSection.identity}
        onToggleRun={deviceSection.onToggleRun}
        staticMode={isStatic === true}
        deviceSelector={deviceSection.selector}
      >
        <Toolbar
          busy={busy}
          previewing={previewing}
          deployReady={deployReady}
          buildAction={buildAction}
          buildRunning={buildRunning}
          checkProgress={checkProgress}
          skipTypeCheck={skipTypeCheck}
          deployChoice={deployChoice}
          autoBuildCheck={autoBuildCheck}
          nextStep={
            readiness.deployReady && isStatic !== true
              ? "deploy"
              : readiness.gates[0].state === "ok" && readiness.gates[1].state === "ok"
                ? "none"
                : "build"
          }
          staticMode={isStatic === true}
          staticControls={
            isStatic ? (
              <StaticFileControls
                viewRef={viewRef}
                setStatus={setStatus}
                onOpened={handleFileOpened}
              />
            ) : undefined
          }
          onSkipTypeCheckChange={setSkipTypeCheck}
          onAutoChange={(on) => {
            setAutoBuildCheck(on);
            localStorage.setItem(AUTO_KEY, on ? "1" : "0");
            if (!on && autoTimer.current) {
              clearTimeout(autoTimer.current);
              autoTimer.current = null;
            }
          }}
          onSave={() => void withBusy(saveScript)}
          onHistory={() => void withBusy(scriptHistory.openHistory)}
          onCheckpoint={() => void withBusy(scriptHistory.checkpoint)}
          onBuild={() => void withBusy(() => runBuildAction())}
          onBuildPick={(action) => {
            setBuildAction(action);
            void withBusy(() => runBuildAction({ action }));
          }}
          onDeploy={() => void withBusy(() => deviceSection.deploy(deployChoice))}
          onDeployPick={(choice) => {
            setDeployChoice(choice);
            void withBusy(() => deviceSection.deploy(choice));
          }}
          onProbe={deviceSection.onProbe}
          probeResults={deviceSection.probeResults}
          probeNote={deviceSection.probeNoteText}
          probeCapture={deviceSection.probeCapture}
          onShowCapture={deviceSection.onShowCapture}
          deployTarget={deviceSection.deployTarget}
        />
      </Header>

      <ReadinessRail
        readiness={readiness}
        status={status}
        statusError={statusError}
        onGate={(id) => {
          if (id === "probed") deviceSection.onProbe();
          else setInspectorTab(id === "built" ? "build" : "check");
        }}
      />

      <Layout
        onResize={() => viewRef.current?.requestMeasure()}
        editor={
          <EditorHost
            banner={deviceSection.editorBanner}
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
          <Inspector
            tab={inspectorTab}
            onTab={setInspectorTab}
            checkFailed={checkFailed}
            checkBadge={
              checkCounts && (checkCounts.errors || checkCounts.warnings)
                ? {
                    text: String(checkCounts.errors || checkCounts.warnings),
                    fail: checkCounts.errors > 0,
                  }
                : null
            }
            checkScale={
              report ? `${tally(report.checks).pass}/${report.checks.length}` : ""
            }
            build={
              <BuildPanel sizeDebug={sizeDebug} sizeProd={sizeProd} patch={dash} />
            }
            check={
              <CheckPanel
                catalog={catalog}
                report={report}
                dialectFindings={dialectFindings}
                onApplyFixes={(fixes) => applyCheckFixes(fixes, viewRef.current, scriptHistory.markSaved, setStatus).then(() => { setReport(null); setCheckFailed(false); deployGate.setCheckOk(false); syncDeployReady(); })}
              />
            }
            options={<OptionsPanel onStatus={setStatus} />}
          />
        }
      />

      {deviceSection.dock}

      <ScriptHistoryModal
        open={scriptHistory.historyOpen}
        rows={scriptHistory.historyRows}
        busy={busy}
        currentSource={scriptHistory.currentSnapshot}
        savedSource={scriptHistory.savedSource}
        loadVersion={scriptHistory.loadHistoryVersion}
        onRestore={(id) => withBusy(() => scriptHistory.restoreVersion(id))}
        onClose={scriptHistory.closeHistory}
      />

      {deviceSection.modals}
    </>
  );
}
