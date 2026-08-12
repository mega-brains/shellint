import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { SplitButton, CLOSE_MENUS_EVENT, closeAllMenus } from "./split-button";
import {
  probeAvailable,
  type ProbeResult,
} from "./probe-logic";

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

export type ToolbarProps = {
  busy: boolean;
  previewing: boolean;
  deployReady: boolean;
  buildAction: BuildAction;
  buildRunning: boolean;
  deployChoice: { mode: Mode; minify: Minify };
  autoBuildCheck: boolean;
  onAutoChange: (on: boolean) => void;
  onSave: () => void;
  onBuild: () => void;
  onBuildPick: (action: BuildAction) => void;
  onDeploy: () => void;
  onDeployPick: (choice: { mode: Mode; minify: Minify }) => void;
  onProbe: () => void;
  probeResults: ProbeResult[] | null;
  probeNote: string;
};

export function Toolbar(props: ToolbarProps) {
  const [buildOpen, setBuildOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [probeOpen, setProbeOpen] = useState(false);
  const [probeFilter, setProbeFilter] = useState("");
  const [probeFailOnly, setProbeFailOnly] = useState(false);

  useEffect(() => {
    const close = () => {
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
  const deployFile =
    minify === "raw" ? `dist/${mode}.raw.js` : `dist/${mode}.js`;
  const deployBase = `Upload ${deployFile} (${mode}, ${minifyLabel(minify)}) to the Shelly script slot over WebSocket RPC`;
  const deployTitle = props.deployReady
    ? deployBase
    : `${deployBase} — disabled until Build + Check succeed`;

  const buildTitle =
    props.buildAction === "check"
      ? "Shelly/Espruino compliance check of scripts/main.ts (and dist artifacts when present). Works offline; adds device capability checks when the device answers."
      : props.buildAction === "build"
        ? "Compile TypeScript to ES5 and emit debug/prod raw + minified artifacts under dist/"
        : "Build, then run the compliance check over the fresh artifacts";

  const results = props.probeResults ?? [];
  let shown = probeFilter.trim()
    ? results.filter((r) =>
        r.id.toLowerCase().includes(probeFilter.trim().toLowerCase()),
      )
    : results;
  if (probeFailOnly) shown = shown.filter((r) => !probeAvailable(r));

  return (
    <div class="toolbar">
      <button
        type="button"
        id="btnSave"
        title="Save editor contents to scripts/main.ts"
        disabled={saveDisabled}
        onClick={props.onSave}
      >
        Save
      </button>

      <SplitButton
        rootId="buildSplit"
        toggleId="btnBuildMenu"
        menuId="buildMenu"
        open={buildOpen}
        onOpenChange={(o) => {
          if (o) {
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
          <button
            type="button"
            id="btnBuild"
            class={props.buildRunning ? "running" : undefined}
            title={buildTitle}
            disabled={props.busy}
            onClick={props.onBuild}
          >
            <span id="btnBuildLabel">{BUILD_LABEL[props.buildAction]}</span>
            <span class="btn-progress" id="btnBuildProgress" />
          </button>
        }
        menu={
          <ul class="menu" id="buildMenu" role="menu">
            <li role="none">
              <button
                type="button"
                role="menuitem"
                data-action="both"
                title="Build, then run the compliance check over the fresh artifacts"
              >
                build + check
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                data-action="build"
                title="Compile TypeScript to ES5 and emit debug/prod raw + minified artifacts under dist/"
              >
                build
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                data-action="check"
                title="Shelly/Espruino compliance check of scripts/main.ts (and dist artifacts when present). Works offline; adds device capability checks when the device answers."
              >
                check
              </button>
            </li>
            <li role="none" class="menu-sep" />
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

      <SplitButton
        rootId="deploySplit"
        toggleId="btnDeployMenu"
        menuId="deployMenu"
        open={deployOpen}
        onOpenChange={(o) => {
          if (o) {
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
          <button
            type="button"
            id="btnDeploy"
            title={deployTitle}
            disabled={deployDisabled}
            onClick={props.onDeploy}
          >
            {`Deploy ${mode} · ${shortMinify(minify)}`}
          </button>
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

      <SplitButton
        rootId="probeSplit"
        toggleId="btnProbeLog"
        menuId="probeLog"
        open={probeOpen}
        onOpenChange={(o) => {
          if (o) {
            setBuildOpen(false);
            setDeployOpen(false);
          }
          setProbeOpen(o);
        }}
        disabled={props.busy}
        toggleTitle="Show the last probe run's per-feature results"
        toggleHasPopup="true"
        primary={
          <button
            type="button"
            id="btnProbe"
            title="Run Script.Eval capability checks on the device and write types/generated-probe.json — stored device scripts are never overwritten"
            disabled={props.busy}
            onClick={props.onProbe}
          >
            Probe
          </button>
        }
        menu={
          <div class="menu probe-log" id="probeLog">
            <p class="probe-log-note" id="probeLogNote">
              {props.probeNote}
            </p>
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
              <button
                type="button"
                id="probeLogFailBtn"
                class="probe-log-quick"
                aria-pressed={probeFailOnly ? "true" : "false"}
                title="Show only failed / unavailable probes"
                onClick={() => setProbeFailOnly((v) => !v)}
              >
                failed only
              </button>
            </div>
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
      <button
        type="button"
        role="menuitem"
        data-mode={props.mode}
        data-minify={props.minify}
        title={`Deploy ${file} (${env}, ${shape})`}
      >
        {label}
      </button>
    </li>
  );
}
