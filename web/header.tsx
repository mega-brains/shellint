import type { ComponentChildren } from "preact";
import type { DeviceIdentity } from "./device-panel";

const MAX_SCRIPT_NAME = 28;

const STATE_GLYPH = { running: "▶", stopped: "■", offline: "✕" } as const;
type RunState = keyof typeof STATE_GLYPH;

const ACTION: Record<RunState, string> = {
  running: "Stop the script on the device",
  stopped: "Start the script on the device",
  offline: "Device unreachable",
};

export type HeaderProps = {
  deviceIp: string;
  configBase: string;
  configFail?: string;
  identity?: DeviceIdentity | null;
  onToggleRun?: (running: boolean) => void;
  children: ComponentChildren;
  status: string;
  statusError?: boolean;
  probeProgress?: { done: number; total: number } | null;
  deviceMeta: string;
};

export function Header(props: HeaderProps) {
  const id = props.identity;
  const name =
    id?.scriptName && id.scriptName.length > MAX_SCRIPT_NAME
      ? `${id.scriptName.slice(0, MAX_SCRIPT_NAME - 1)}…`
      : id?.scriptName;

  let configText = props.configFail ?? "";
  if (!props.configFail && props.configBase) {
    configText = name ? `${props.configBase} · “${name}”` : props.configBase;
  }

  const warn =
    id?.state === "offline" || id?.state === "stopped" ? "warn" : "";

  const pct =
    props.probeProgress && props.probeProgress.total > 0
      ? Math.min(
          100,
          Math.round(
            (props.probeProgress.done / props.probeProgress.total) * 100,
          ),
        )
      : 0;

  return (
    <header class="top">
      <div class="top-row">
        <div class="title-stack">
          <p class="device-ip" id="deviceIp">
            {props.deviceIp ? (
              <>
                <a
                  class="device-link"
                  href={`http://${props.deviceIp}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open the device web UI at http://${props.deviceIp} in a new tab`}
                >
                  {props.deviceIp}
                </a>
                {id?.deviceName ? ` (${id.deviceName})` : ""}
              </>
            ) : null}
          </p>
          <h1>Shelly DevRoom</h1>
        </div>
        <p class={`sub ${warn}`} id="configLine">
          {configText || "loading config…"}
          {id && id.state !== "unknown" && !props.configFail ? (
            <>
              {" · "}
              <RunIcon
                state={id.state}
                onToggle={
                  props.onToggleRun &&
                  (() => props.onToggleRun!(id.state !== "running"))
                }
              />
            </>
          ) : null}
        </p>
        {props.children}
      </div>
      <p class="device-meta" id="deviceMeta">
        {props.deviceMeta}
      </p>
      <div
        class="gauge probe-progress"
        id="probeProgress"
        hidden={props.probeProgress == null}
      >
        <div
          class="gauge-fill"
          id="probeProgressFill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p
        class={`status${props.statusError ? " error" : ""}`}
        id="statusLine"
        role="status"
      >
        {props.status}
      </p>
    </header>
  );
}

function RunIcon(props: { state: RunState; onToggle?: () => void }) {
  const actionable = props.state !== "offline" && props.onToggle;
  const common = {
    class: `run-state run-${props.state}`,
    title: ACTION[props.state],
    "aria-label": `${props.state} — ${ACTION[props.state].toLowerCase()}`,
  };
  if (actionable) {
    return (
      <button type="button" {...common} onClick={props.onToggle}>
        {STATE_GLYPH[props.state]}
      </button>
    );
  }
  return (
    <span {...common} role="img">
      {STATE_GLYPH[props.state]}
    </span>
  );
}
