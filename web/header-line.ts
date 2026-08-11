import type { DeviceIdentity } from "./device-panel";

/**
 * The header's two identity lines: the device address (with the device's own
 * name) above the title, and the script line beside it. Owns its element
 * lookups so main.ts stays inside the 500-line source cap.
 */
const MAX_SCRIPT_NAME = 28;

const STATE_GLYPH = { running: "▶", stopped: "■", offline: "✕" };

type RunState = keyof typeof STATE_GLYPH;

const ACTION: Record<RunState, string> = {
  running: "Stop the script on the device",
  stopped: "Start the script on the device",
  offline: "Device unreachable",
};

/**
 * The script's state, and the control that flips it. Offline is not actionable,
 * so it stays a plain glyph rather than a button that could only fail.
 */
function stateIcon(state: RunState, onToggle?: () => void): HTMLElement {
  const actionable = state !== "offline" && onToggle;
  const icon = document.createElement(actionable ? "button" : "span");
  icon.className = `run-state run-${state}`;
  icon.textContent = STATE_GLYPH[state];
  icon.title = ACTION[state];
  icon.setAttribute("aria-label", `${state} — ${ACTION[state].toLowerCase()}`);
  if (icon instanceof HTMLButtonElement && onToggle) {
    icon.type = "button";
    icon.addEventListener("click", onToggle);
  } else {
    icon.setAttribute("role", "img");
  }
  return icon;
}

export function createHeaderLine(onToggleRun?: (running: boolean) => void) {
  const configLine = document.getElementById("configLine")!;
  const ipLine = document.getElementById("deviceIp")!;

  let configBase = "";
  let deviceIp = "";

  /** Static config plus whatever the last poll learned about the device. */
  function sync(id?: DeviceIdentity) {
    if (!configBase) return;
    // Address and device name identify one box, so they travel together.
    const link = document.createElement("a");
    link.className = "device-link";
    link.href = `http://${deviceIp}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = deviceIp;
    link.title = `Open the device web UI at http://${deviceIp} in a new tab`;
    ipLine.replaceChildren(
      link,
      id?.deviceName ? ` (${id.deviceName})` : "",
    );
    if (!id) {
      configLine.textContent = configBase;
      return;
    }
    const name =
      id.scriptName && id.scriptName.length > MAX_SCRIPT_NAME
        ? `${id.scriptName.slice(0, MAX_SCRIPT_NAME - 1)}…`
        : id.scriptName;
    configLine.replaceChildren(
      name ? `${configBase} · “${name}”` : configBase,
    );
    if (id.state !== "unknown") {
      configLine.append(
        " · ",
        stateIcon(
          id.state,
          onToggleRun && (() => onToggleRun(id.state !== "running")),
        ),
      );
    }
    configLine.classList.toggle(
      "warn",
      id.state === "offline" || id.state === "stopped",
    );
  }

  return {
    sync,
    setConfig(ip: string, scriptId: number) {
      deviceIp = ip;
      configBase = `script ${scriptId}`;
      sync();
    },
    fail(message: string) {
      configLine.textContent = message;
    },
  };
}
