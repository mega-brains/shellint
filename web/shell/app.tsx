import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { EditorView } from "@codemirror/view";
import { Header } from "./header";
import { Toolbar, type BuildAction, type Minify, type Mode } from "./toolbar";
import { Layout } from "./layout";
import { EditorHost } from "../editor/editor-host";
import { BuildPanel, type DashboardPatch } from "../stats/dashboard";
import { CheckPanel, summarize, type CheckCatalog, type CheckReport, type Finding } from "../check/check-panel";
import { OptionsPanel } from "./options-panel";
import { api } from "../lib/api";
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

const AUTO_KEY = "shelly-devroom.autoBuildCheck";

export function App() {
  const [status, setStatusMsg] = useState("ready");
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [buildRunning, setBuildRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [deployReady, setDeployReady] = useState(false);
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
  const [isStatic, setIsStatic] = useState(false);
  const [sizeDebug, setSizeDebug] = useState<Sizes>({});
  const [sizeProd, setSizeProd] = useState<Sizes>({});
  const [dash, setDash] = useState<DashboardPatch>({ history: [] });
  const [catalog, setCatalog] = useState<CheckCatalog | null>(null);
  const [report, setReport] = useState<CheckReport | null>(null);
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
    async ({ quiet = false } = {}) => {
      if (!quiet) {
        setStatus(
          deviceSection.deviceOnline ? "checking (with device)…" : "checking…",
        );
      }
      const data = await api<{ report: CheckReport }>("/api/check", {
        method: "POST",
        body: JSON.stringify({ connected: deviceSection.deviceOnline }),
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
    }).catch((e) =>
      reportBuildFailure(view, e),
    );
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
    async (action = buildAction, skipTypes = skipTypeCheck) => {
      setBuildRunning(true);
      try {
        if (action === "check") return await checkScript();
        await buildScript(skipTypes);
        if (action === "both") await checkScript();
      } finally {
        setBuildRunning(false);
      }
    },
    [buildAction, buildScript, checkScript, skipTypeCheck],
  );

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

  return (
    <>
      <Header
        deviceIp={deviceSection.shownIp}
        configFail={configFail}
        identity={deviceSection.identity}
        onToggleRun={deviceSection.onToggleRun}
        status={status}
        statusError={statusError}
        probeProgress={deviceSection.probeProgress}
        deviceMeta={deviceSection.deviceMeta}
        deviceSelector={deviceSection.selector}
      >
        <Toolbar
          busy={busy}
          previewing={previewing}
          deployReady={deployReady}
          buildAction={buildAction}
          buildRunning={buildRunning}
          skipTypeCheck={skipTypeCheck}
          deployChoice={deployChoice}
          autoBuildCheck={autoBuildCheck}
          staticMode={isStatic}
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
            void withBusy(() => runBuildAction(action));
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
            <OptionsPanel onStatus={setStatus} />
          </>
        }
        footer={deviceSection.footer}
      />

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
