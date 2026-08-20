import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Button, ButtonDropdown, CLOSE_MENUS_EVENT, closeAllMenus } from "../ui/button";
import {
  probeAvailable,
  type ProbeResult,
} from "../probe/probe-logic";
import { ProbeCopyButtons } from "../probe/probe-copy";
import type { ProbeCapture } from "../probe/use-probe";

export type Mode = "debug" | "prod";
export type Minify = "min" | "raw";
export type BuildAction = "build" | "check" | "both";

const BUILD_LABEL: Record<BuildAction, string> = {
  build: "Build",
  check: "Check",
  both: "Build + Check",
};

function shortMinify(m: Minify): string {
  return m === "raw" ? "raw" : "min";
}

function minifyLabel(m: Minify): string {
  return m === "raw" ? "non-minified" : "minified";
}

/** Capture timestamps are stored as ISO; show local time, fall back to raw. */
function formatAt(at: string): string {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? at || "unknown time" : new Date(ms).toLocaleString();
}

export type ToolbarProps = {
  busy: boolean;
  previewing: boolean;
  deployReady: boolean;
  buildAction: BuildAction;
  buildRunning: boolean;
  checkProgress: { done: number; total: number } | null;
  skipTypeCheck: boolean;
  deployChoice: { mode: Mode; minify: Minify };
  autoBuildCheck: boolean;
  /** Accent budget: exactly one filled button, whichever step the rail says is
   * next — Build + Check while the build/check is stale, Deploy once ready. */
  nextStep: "build" | "deploy" | "none";
  /** Static/offline build (M17): device-touching controls (Deploy, Probe) and
   * the server-backed script history (history/checkpoint) don't apply — see
   * web/shell/device-section.tsx. */
  staticMode?: boolean;
  /** `web/shell/static-file-controls.tsx` (M17.6), constructed by app.tsx — kept as
   * an opaque slot here rather than a static-only import (see that file's header). */
  staticControls?: ComponentChildren;
  onSkipTypeCheckChange: (skip: boolean) => void;
  onAutoChange: (on: boolean) => void;
  onSave: () => void;
  onHistory: () => void;
  onCheckpoint: () => void;
  onBuild: () => void;
  onBuildPick: (action: BuildAction) => void;
  onDeploy: () => void;
  onDeployPick: (choice: { mode: Mode; minify: Minify }) => void;
  onProbe: () => void;
  probeResults: ProbeResult[] | null;
  probeNote: string;
  /** Where the shown run is stored on disk; clicking the path opens it. */
  probeCapture?: ProbeCapture | null;
  onShowCapture?: () => void;
  /** "Kitchen:1" — appended to the Deploy label so the target is never a guess. */
  deployTarget?: string;
};

function deployTitleOf(choice: { mode: Mode; minify: Minify }, ready: boolean) {
  const { mode, minify } = choice;
  const file = minify === "raw" ? `dist/${mode}.raw.js` : `dist/${mode}.js`;
  const base = `Upload ${file} (${mode}, ${minifyLabel(minify)}) to the Shelly script slot over WebSocket RPC`;
  return ready
    ? base
    : `${base} — disabled until Build + Check succeed and the active device is probed (or skipped)`;
}

function buildTitleOf(action: BuildAction) {
  if (action === "check") {
    return "Shelly/Espruino compliance check of scripts/main.ts (and dist artifacts when present). Works offline; adds device capability checks when the device answers.";
  }
  if (action === "build") {
    return "Compile TypeScript to ES5 and emit debug/prod raw + minified artifacts under dist/";
  }
  return "Build, then run the compliance check over the fresh artifacts";
}

function visibleProbes(
  results: ProbeResult[],
  filter: string,
  failOnly: boolean,
) {
  const needle = filter.trim().toLowerCase();
  const matched = needle
    ? results.filter((r) => r.id.toLowerCase().includes(needle))
    : results;
  return failOnly ? matched.filter((r) => !probeAvailable(r)) : matched;
}

export function Toolbar(props: ToolbarProps) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [probeOpen, setProbeOpen] = useState(false);
  const [probeFilter, setProbeFilter] = useState("");
  const [probeFailOnly, setProbeFailOnly] = useState(false);

  useEffect(() => {
    const close = () => {
      setSaveOpen(false);
      setBuildOpen(false);
      setDeployOpen(false);
      setProbeOpen(false);
    };
    document.addEventListener(CLOSE_MENUS_EVENT, close);
    return () => document.removeEventListener(CLOSE_MENUS_EVENT, close);
  }, []);

  useEffect(() => {
    if (props.busy) closeAllMenus();
  }, [props.busy]);

  const saveDisabled = props.busy || props.previewing;
  const deployDisabled = props.busy || !props.deployReady;
  const { mode, minify } = props.deployChoice;
  const deployTitle = deployTitleOf(props.deployChoice, props.deployReady);
  const buildTitle = buildTitleOf(props.buildAction);
  const results = props.probeResults ?? [];
  const shown = visibleProbes(results, probeFilter, probeFailOnly);

  return (
    <div class="toolbar">
      <ButtonDropdown
        rootId="saveSplit"
        toggleId="btnSaveMenu"
        menuId="saveMenu"
        open={saveOpen}
        onOpenChange={(o) => {
          if (o) {
            setBuildOpen(false);
            setDeployOpen(false);
            setProbeOpen(false);
          }
          setSaveOpen(o);
        }}
        /* Only the primary Save is blocked while previewing an artifact —
           checkpoint/history stay reachable from the menu. */
        disabled={props.busy}
        toggleTitle="Checkpoint the file, or browse saved versions"
        onPick={(item) => {
          if (item.dataset.action === "history") props.onHistory();
          else props.onCheckpoint();
        }}
        primary={
          <Button
            id="btnSave"
            title="Save editor contents to scripts/main.ts"
            disabled={saveDisabled}
            onClick={props.onSave}
          >
            Save
          </Button>
        }
        menu={
          <ul class="menu" id="saveMenu" role="menu">
            <li role="none">
              <Button
                role="menuitem"
                data-action="checkpoint"
                title="Save a version-history checkpoint of the file on disk right now, independent of the next Save"
              >
                checkpoint
              </Button>
            </li>
            <li role="none">
              <Button
                role="menuitem"
                id="btnHistory"
                data-action="history"
                title="Browse and restore previous saved versions of scripts/main.ts"
              >
                history…
              </Button>
            </li>
          </ul>
        }
      />

      <ButtonDropdown
        rootId="buildSplit"
        toggleId="btnBuildMenu"
        menuId="buildMenu"
        open={buildOpen}
        onOpenChange={(o) => {
          if (o) {
            setSaveOpen(false);
            setDeployOpen(false);
            setProbeOpen(false);
          }
          setBuildOpen(o);
        }}
        disabled={props.busy}
        toggleTitle="Choose build, compliance check, or both"
        onPick={(item) => {
          const action =
            (item.dataset.action as BuildAction | undefined) ?? "build";
          props.onBuildPick(action);
        }}
        primary={
          <Button
            id="btnBuild"
            class={[
              props.buildRunning ? "running" : null,
              props.nextStep === "build" ? "btn-primary" : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined}
            title={buildTitle}
            disabled={props.busy}
            onClick={props.onBuild}
          >
            <span id="btnBuildLabel">
              {BUILD_LABEL[props.buildAction]}
              {props.checkProgress
                ? ` ${props.checkProgress.done}/${props.checkProgress.total}`
                : ""}
            </span>
            {props.checkProgress ? (
              <progress
                class="btn-progress"
                id="btnBuildProgress"
                value={props.checkProgress.done}
                max={props.checkProgress.total}
                aria-label={`Checking ${props.checkProgress.done} of ${props.checkProgress.total} checks`}
              />
            ) : null}
          </Button>
        }
        menu={
          <ul class="menu" id="buildMenu" role="menu">
            <li role="none">
              <Button
                role="menuitem"
                data-action="both"
                title="Build, then run the compliance check over the fresh artifacts"
              >
                build + check
              </Button>
            </li>
            <li role="none">
              <Button
                role="menuitem"
                data-action="build"
                title="Compile TypeScript to ES5 and emit debug/prod raw + minified artifacts under dist/"
              >
                build
              </Button>
            </li>
            <li role="none">
              <Button
                role="menuitem"
                data-action="check"
                title="Shelly/Espruino compliance check of scripts/main.ts (and dist artifacts when present). Works offline; adds device capability checks when the device answers."
              >
                check
              </Button>
            </li>
            <li role="none" class="menu-sep" />
            <li role="none">
              <label
                class="logs-follow menu-check"
                title="Skip TypeScript check during Build"
              >
                <input
                  type="checkbox"
                  id="skipTypeCheck"
                  checked={props.skipTypeCheck}
                  onChange={(e: JSX.TargetedEvent<HTMLInputElement>) =>
                    props.onSkipTypeCheckChange(e.currentTarget.checked)
                  }
                  onClick={(e) => e.stopPropagation()}
                />
                skip TypeScript check
              </label>
            </li>
            <li role="none">
              <label
                class="logs-follow menu-check"
                title="Save + Build + Check automatically 3s after each edit"
              >
                <input
                  type="checkbox"
                  id="autoBuildCheck"
                  checked={props.autoBuildCheck}
                  onChange={(e: JSX.TargetedEvent<HTMLInputElement>) =>
                    props.onAutoChange(e.currentTarget.checked)
                  }
                  onClick={(e) => e.stopPropagation()}
                />
                auto
              </label>
            </li>
          </ul>
        }
      />

      {props.staticMode ? null : (
      <ButtonDropdown
        rootId="deploySplit"
        toggleId="btnDeployMenu"
        menuId="deployMenu"
        open={deployOpen}
        onOpenChange={(o) => {
          if (o) {
            setSaveOpen(false);
            setBuildOpen(false);
            setProbeOpen(false);
          }
          setDeployOpen(o);
        }}
        disabled={deployDisabled}
        toggleTitle="Choose debug/prod and minified/non-minified, then deploy"
        onPick={(item) => {
          props.onDeployPick({
            mode: item.dataset.mode === "prod" ? "prod" : "debug",
            minify: item.dataset.minify === "raw" ? "raw" : "min",
          });
        }}
        primary={
          <Button
            id="btnDeploy"
            class={props.nextStep === "deploy" ? "btn-primary" : undefined}
            title={deployTitle}
            disabled={deployDisabled}
            onClick={props.onDeploy}
          >
            Deploy
            {/* Dropped below 1100px (panels-extra.css) — the title keeps it. */}
            <span class="btn-detail" id="btnDeployDetail">
              {` ${mode} · ${shortMinify(minify)}${props.deployTarget ? ` → ${props.deployTarget}` : ""}`}
            </span>
          </Button>
        }
        menu={
          <ul class="menu" id="deployMenu" role="menu">
            <DeployItem mode="debug" minify="min" />
            <DeployItem mode="debug" minify="raw" />
            <DeployItem mode="prod" minify="min" />
            <DeployItem mode="prod" minify="raw" />
          </ul>
        }
      />
      )}

      {props.staticMode ? null : (
      <ButtonDropdown
        rootId="probeSplit"
        toggleId="btnProbeLog"
        menuId="probeLog"
        open={probeOpen}
        onOpenChange={(o) => {
          if (o) {
            setSaveOpen(false);
            setBuildOpen(false);
            setDeployOpen(false);
          }
          setProbeOpen(o);
        }}
        disabled={props.busy}
        toggleTitle="Show the last probe run's per-feature results"
        toggleHasPopup="true"
        primary={
          <Button
            id="btnProbe"
            title="Run Script.Eval capability checks on the device and write types/generated-probe.json — stored device scripts are never overwritten"
            disabled={props.busy}
            onClick={props.onProbe}
          >
            Probe
          </Button>
        }
        menu={
          <div class="menu probe-log" id="probeLog">
            <p class="probe-log-note" id="probeLogNote">
              {props.probeNote}
            </p>
            {props.probeCapture ? (
              <div class="probe-log-note probe-log-meta" id="probeLogMeta">
                <span class="probe-log-at" title="When this capture was taken">
                  {formatAt(props.probeCapture.at)}
                </span>
                <Button
                  id="probeLogPath"
                  class="probe-log-path"
                  title={`Open ${props.probeCapture.path}`}
                  onClick={() => props.onShowCapture?.()}
                >
                  {props.probeCapture.path}
                </Button>
              </div>
            ) : null}
            <div class="probe-log-row">
              <input
                type="search"
                id="probeLogFilter"
                class="probe-log-filter"
                placeholder="filter…"
                aria-label="Filter probe results"
                value={probeFilter}
                onInput={(e: JSX.TargetedEvent<HTMLInputElement>) =>
                  setProbeFilter(e.currentTarget.value)
                }
              />
              <Button
                id="probeLogFailBtn"
                class="probe-log-quick"
                aria-pressed={probeFailOnly ? "true" : "false"}
                title="Show only failed / unavailable probes"
                onClick={() => setProbeFailOnly((v) => !v)}
              >
                failed only
              </Button>
            </div>
            <ProbeCopyButtons results={shown} />
            <ol class="probe-log-list" id="probeLogList">
              {shown.map((r) => (
                <li key={r.id} class={probeAvailable(r) ? "ok" : "fail"}>
                  <span class="probe-log-id">{r.id}</span>
                  <span class="probe-log-val">
                    {r.ok ? JSON.stringify(r.result) : `FAIL ${r.error}`}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        }
      />
      )}

      {props.staticControls}
    </div>
  );
}

function DeployItem(props: { mode: Mode; minify: Minify }) {
  const file =
    props.minify === "raw"
      ? `dist/${props.mode}.raw.js`
      : `dist/${props.mode}.js`;
  const label =
    props.minify === "raw"
      ? `${props.mode} · non-minified`
      : `${props.mode} · minified`;
  const env = props.mode === "prod" ? "meta.env.prod" : "meta.env.debug";
  const shape =
    props.minify === "raw" ? "readable / non-minified" : "minified";
  return (
    <li role="none">
      <Button
        role="menuitem"
        data-mode={props.mode}
        data-minify={props.minify}
        title={`Deploy ${file} (${env}, ${shape})`}
      >
        {label}
      </Button>
    </li>
  );
}
