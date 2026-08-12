import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { DeviceIdentity } from "./device-panel";

const STATE_GLYPH = { running: "▶", stopped: "■", offline: "✕" } as const;
type RunState = keyof typeof STATE_GLYPH;

const ACTION: Record<RunState, string> = {
  running: "Stop the script on the device",
  stopped: "Start the script on the device",
  offline: "Device unreachable",
};

export type HeaderProps = {
  deviceIp: string;
  configFail?: string;
  identity?: DeviceIdentity | null;
  onToggleRun?: (running: boolean) => void;
  children: ComponentChildren;
  status: string;
  statusError?: boolean;
  probeProgress?: { done: number; total: number } | null;
  deviceMeta: string;
  /** Device + slot pickers (web/device-select.tsx, web/slot-select.tsx), rendered next to the title. */
  deviceSelector?: ComponentChildren;
};

export function Header(props: HeaderProps) {
  const [statusHidden, setStatusHidden] = useState(false);
  useEffect(() => setStatusHidden(false), [props.status]);

  const id = props.identity;

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
        <div class={`sub device-picker-row ${warn}`} id="configLine">
          {props.configFail ? (
            <span class="picker-fail">{props.configFail}</span>
          ) : (
            props.deviceSelector
          )}
          {id && id.state !== "unknown" && !props.configFail ? (
            <RunIcon
              state={id.state}
              onToggle={
                props.onToggleRun &&
                (() => props.onToggleRun!(id.state !== "running"))
              }
            />
          ) : null}
        </div>
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
        hidden={statusHidden}
      >
        {props.status}
        <button
          type="button"
          class="status-close"
          onClick={() => setStatusHidden(true)}
          aria-label="Dismiss status"
          title="Dismiss status"
        >
          ×
        </button>
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
    const preview: RunState =
      props.state === "running" ? "stopped" : "running";
    return (
      <button type="button" {...common} onClick={props.onToggle}>
        <span class="run-glyph run-glyph-current">{STATE_GLYPH[props.state]}</span>
        <span class="run-glyph run-glyph-action" aria-hidden="true">
          {STATE_GLYPH[preview]}
        </span>
      </button>
    );
  }
  return (
    <span {...common} role="img">
      {STATE_GLYPH[props.state]}
    </span>
  );
}
