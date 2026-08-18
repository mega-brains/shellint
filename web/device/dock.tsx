import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button, CLOSE_MENUS_EVENT, closeAllMenus } from "../ui/button";
import { useSplitter } from "../ui/splitter";
import type { DeviceStatusState } from "./use-device-status";

export type DockTab = "device" | "logs";

const OPEN_KEY = "shellint.dock.open";
const TAB_KEY = "shellint.dock.tab";

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled */
  }
}

function readTab(): DockTab {
  try {
    return localStorage.getItem(TAB_KEY) === "logs" ? "logs" : "device";
  } catch {
    return "device";
  }
}

export type DockProps = {
  state: DeviceStatusState;
  device: ComponentChildren;
  logs: ComponentChildren;
  /** Editor re-measure after the dock steals or returns height. */
  onResize?: () => void;
};

/**
 * Device telemetry + debug log, in a dock that owns a fixed grid row — 46px
 * collapsed, 300px open, with its own internal scroll. That is what makes the
 * old sub-1000px overlap (footer on top of the options panel) impossible.
 */
export function Dock(props: DockProps) {
  const [open, setOpen] = useState(() => readFlag(OPEN_KEY, false));
  const [tab, setTab] = useState<DockTab>(readTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const { state } = props;

  // The splitter trades height with the workspace, so its root is `#app` —
  // reached through the section's parent rather than by id lookup. A callback
  // ref fills both before any effect runs.
  const rootRef = useRef<HTMLElement | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const onResize = useRef(props.onResize);
  onResize.current = props.onResize;

  useSplitter(rootRef, handleRef, dockRef, {
    storageKey: "shellint.dock.height",
    cssVar: "--dock-h",
    axis: "y",
    minPanel: 140,
    minEditor: 220,
    onResize: () => onResize.current?.(),
  });

  useEffect(() => {
    const close = () => setMenuOpen(false);
    document.addEventListener(CLOSE_MENUS_EVENT, close);
    return () => document.removeEventListener(CLOSE_MENUS_EVENT, close);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("#deviceMenu")) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    write(OPEN_KEY, next ? "1" : "0");
    onResize.current?.();
  };

  const pick = (next: DockTab) => {
    setTab(next);
    write(TAB_KEY, next);
    if (!open) toggleOpen();
  };

  return (
    <section
      class={`dock${open ? " open" : ""}`}
      id="dock"
      aria-label="Device dock"
      ref={(el) => {
        dockRef.current = el;
        rootRef.current = el?.parentElement ?? null;
      }}
    >
      <div
        class="splitter dock-splitter"
        id="dockSplitter"
        ref={handleRef}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the dock — drag, arrow keys, or double-click to reset"
        title="Drag to resize the dock · arrow keys to nudge · double-click to reset"
        tabindex={0}
      />
      <div class="dock-head" id="dockHead">
        <div class="tabs dock-tabs" role="tablist" aria-label="Dock">
          {(["device", "logs"] as DockTab[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              class={`tab${tab === id ? " active" : ""}`}
              id={`${id}Head`}
              data-testid={`dock-tab-${id}`}
              aria-selected={tab === id ? "true" : "false"}
              aria-controls={`dock-pane-${id}`}
              onClick={() => pick(id)}
            >
              {id}
            </button>
          ))}
        </div>
        <p class={`dock-peek${state.err ? " error" : ""}`} id="dockPeek">
          {open ? state.meta : state.peek}
        </p>
        <span class="dock-spacer" />
        <label
          class="eco"
          title="Sys.config.device.eco_mode — lower CPU clock + WiFi power-save; raises latency"
        >
          <input
            type="checkbox"
            id="ecoToggle"
            disabled={state.eco.disabled}
            checked={state.eco.checked}
            onChange={(e) => state.eco.toggle((e.target as HTMLInputElement).checked)}
          />
          {`eco ${state.eco.checked ? "on" : "off"}`}
        </label>
        <div class="device-menu" id="deviceMenu">
          <Button
            id="btnDeviceMenu"
            class="dock-btn"
            data-testid="device-menu-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen ? "true" : "false"}
            aria-controls="deviceMenuList"
            title="Device actions"
            disabled={state.rebootBusy}
            onClick={(e) => {
              e.stopPropagation();
              const next = !menuOpen;
              if (next) closeAllMenus();
              setMenuOpen(next);
            }}
          >
            ⋯
          </Button>
          <ul class="menu" id="deviceMenuList" role="menu" hidden={!menuOpen}>
            <li role="none">
              <Button
                role="menuitem"
                data-testid="device-reboot-item"
                title="Shelly.Reboot — soft restart (not factory reset)"
                disabled={state.offline || state.rebootBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  state.reboot();
                }}
              >
                Reboot device
              </Button>
            </li>
          </ul>
        </div>
        <Button
          class="dock-collapse"
          id="dockToggle"
          aria-expanded={open ? "true" : "false"}
          aria-controls="dock"
          title={open ? "Collapse the dock" : "Expand the dock"}
          onClick={toggleOpen}
        >
          {open ? "⌄ collapse" : "⌃ expand"}
        </Button>
      </div>

      {/* Both panes stay mounted whatever the dock is doing: the log stream
          polls from `LogsPanel`, and collapsing the dock must not close it. */}
      <div
        class="dock-pane"
        id="dock-pane-device"
        role="tabpanel"
        hidden={!open || tab !== "device"}
      >
        {props.device}
      </div>
      <div
        class="dock-pane"
        id="dock-pane-logs"
        role="tabpanel"
        hidden={!open || tab !== "logs"}
      >
        {props.logs}
      </div>
    </section>
  );
}
