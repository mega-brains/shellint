import type { ComponentChildren } from "preact";
import type { DeviceIdentity } from "../device/device-panel";
import { Button } from "../ui/button";
import { useTheme } from "./theme";

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
  /** Static/offline build — no device, so no pickers and no run-state chip. */
  staticMode?: boolean;
  /** Device + slot pickers (web/device/device-picker.tsx). */
  deviceSelector?: ComponentChildren;
};

/**
 * One 52px row: wordmark · device chip · slot chip · run-state chip · toolbar.
 * Nothing overlaps anything (the old header rode the device IP over the H1's
 * ascenders), and no transient text lives here — that is the rail's job.
 */
export function Header(props: HeaderProps) {
  const id = props.identity;
  return (
    <header class="top">
      <div class="wordmark">
        <span class="wordmark-dot" aria-hidden="true" />
        <h1>DevRoom</h1>
      </div>

      {props.staticMode ? (
        // Static build only: the app now lives at site/demo/, one level
        // below the presentation site's landing page, so "back" is `../`.
        // Relative, never root-absolute — `test-static-bundle.mjs` fails
        // the build on a root-relative ref in shipped HTML.
        <a
          class="chip"
          id="backToSite"
          href="../"
          title="Back to the DevRoom site"
          aria-label="Back to the DevRoom site"
        >
          ← DevRoom
        </a>
      ) : null}

      {props.staticMode ? (
        <span class="chip" id="staticNote">
          offline playground · no device
        </span>
      ) : props.configFail ? (
        <span class="chip picker-fail" id="configLine">
          {props.configFail}
        </span>
      ) : (
        <div class="picker-row" id="configLine">
          {props.deviceIp ? (
            <a
              class="chip-mono device-link"
              id="deviceIp"
              href={`http://${props.deviceIp}`}
              target="_blank"
              rel="noreferrer"
              title={`Open the device web UI at http://${props.deviceIp} in a new tab`}
            >
              {props.deviceIp}
            </a>
          ) : null}
          {props.deviceSelector}
        </div>
      )}

      {id && id.state !== "unknown" && !props.configFail && !props.staticMode ? (
        <RunChip
          state={id.state}
          onToggle={
            props.onToggleRun &&
            (() => props.onToggleRun!(id.state !== "running"))
          }
        />
      ) : null}

      <div class="top-spacer" />
      <ThemeToggle />
      {props.children}
    </header>
  );
}

/** Dark ↔ light override of the OS preference; glyph shows the target. */
function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button
      class="chip chip-icon"
      id="themeToggle"
      onClick={toggle}
      title={`Switch to the ${next} theme`}
      aria-label={`Switch to the ${next} theme`}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
    </Button>
  );
}

const RUN_LABEL: Record<RunState, string> = {
  running: "running",
  stopped: "stopped",
  offline: "offline",
};

function RunChip(props: { state: RunState; onToggle?: () => void }) {
  const actionable = props.state !== "offline" && props.onToggle;
  const common = {
    class: `chip chip-run run-state run-${props.state}`,
    title: ACTION[props.state],
    "aria-label": `${props.state} — ${ACTION[props.state].toLowerCase()}`,
  };
  if (!actionable) {
    return (
      <span {...common} role="img">
        <span class="run-glyph">{STATE_GLYPH[props.state]}</span>
        <span class="run-label">{RUN_LABEL[props.state]}</span>
      </span>
    );
  }
  const preview: RunState = props.state === "running" ? "stopped" : "running";
  return (
    <Button {...common} onClick={props.onToggle}>
      <span class="run-glyph run-glyph-current">{STATE_GLYPH[props.state]}</span>
      <span class="run-glyph run-glyph-action" aria-hidden="true">
        {STATE_GLYPH[preview]}
      </span>
      <span class="run-label">{RUN_LABEL[props.state]}</span>
    </Button>
  );
}
