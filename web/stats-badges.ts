import { HIGHLIGHT_LINES_EVENT, type LineHighlight } from "./line-highlight";

/** Uncapped script counters as a tile grid — no bar, because there is no cap. */
export type BadgeStats = {
  apis: Record<string, number>;
  declarations: { vars: number; functions: number };
  literals: { strings: { count: number; totalBytes: number } };
  logging: { consoleLog: number; print: number };
  network: { shellyCall: number };
  sites?: StatSites;
};

/** 1-based source lines behind each counter, as computed by the analyzer. */
export type StatSites = {
  apis: number[];
  vars: number[];
  functions: number[];
  strings: number[];
  consoleLog: number[];
  print: number[];
  shellyCall: number[];
};

/** The counters are always derived from the editable source, never a build. */
const SOURCE_FILE = "scripts/main.ts";

type Badge = {
  value: string;
  label: string;
  hint?: string;
  title: string;
  lines?: number[];
};

function badgesFrom(stats: BadgeStats): Badge[] {
  const kinds = Object.keys(stats.apis).length;
  const calls = Object.values(stats.apis).reduce((a, b) => a + b, 0);
  const str = stats.literals.strings;
  const sites = stats.sites;
  return [
    {
      value: `${kinds}`,
      label: "api kinds",
      title: `${kinds} distinct Shelly/Espruino APIs used`,
      lines: sites?.apis,
    },
    {
      value: `${calls}`,
      label: "api calls",
      title: `${calls} call sites across those APIs`,
      lines: sites?.apis,
    },
    {
      value: `${stats.declarations.vars}`,
      label: "vars",
      title: "top-level and local variable declarations",
      lines: sites?.vars,
    },
    {
      value: `${stats.declarations.functions}`,
      label: "functions",
      title: "function declarations and expressions",
      lines: sites?.functions,
    },
    {
      value: `${str.count}`,
      label: "strings",
      hint: `${str.totalBytes} B`,
      title: `${str.count} string literals totalling ${str.totalBytes} B`,
      lines: sites?.strings,
    },
    {
      value: `${stats.logging.consoleLog}`,
      label: "console.log",
      title: "console.log/warn/error call sites",
      lines: sites?.consoleLog,
    },
    {
      value: `${stats.logging.print}`,
      label: "print",
      title: "print() call sites — cheaper than console.log on device",
      lines: sites?.print,
    },
    {
      value: `${stats.network.shellyCall}`,
      label: "Shelly.call",
      title: "asynchronous RPC calls — the device allows 5 concurrent",
      lines: sites?.shellyCall,
    },
  ];
}

function highlight(lines: number[]): void {
  document.dispatchEvent(
    new CustomEvent<LineHighlight>(HIGHLIGHT_LINES_EVENT, {
      detail: { file: SOURCE_FILE, lines },
    }),
  );
}

export function renderStatBadges(
  host: HTMLElement,
  stats: BadgeStats | null | undefined,
): void {
  host.replaceChildren();
  if (!stats) {
    const empty = document.createElement("p");
    empty.className = "stats-bars-empty";
    empty.textContent = "no stats yet — Build to analyze";
    host.appendChild(empty);
    return;
  }

  /** At most one badge owns the editor highlight; clicking it again clears. */
  let active: HTMLElement | null = null;

  for (const badge of badgesFrom(stats)) {
    const lines = badge.lines ?? [];
    const tile = document.createElement(lines.length ? "button" : "div");
    tile.className = "stat-badge";
    tile.title = lines.length
      ? `${badge.title}\nclick to highlight the ${lines.length} line${lines.length === 1 ? "" : "s"} in the editor`
      : badge.title;
    if (tile instanceof HTMLButtonElement) {
      tile.type = "button";
      tile.classList.add("clickable");
      tile.setAttribute("aria-pressed", "false");
      tile.addEventListener("click", () => {
        const on = active !== tile;
        active?.classList.remove("active");
        active?.setAttribute("aria-pressed", "false");
        tile.classList.toggle("active", on);
        tile.setAttribute("aria-pressed", on ? "true" : "false");
        active = on ? tile : null;
        highlight(on ? lines : []);
      });
    }

    const value = document.createElement("span");
    value.className = "stat-badge-value";
    value.textContent = badge.value;

    const label = document.createElement("span");
    label.className = "stat-badge-label";
    label.textContent = badge.label;

    tile.append(value, label);

    if (badge.hint) {
      const hint = document.createElement("span");
      hint.className = "stat-badge-hint";
      hint.textContent = badge.hint;
      tile.appendChild(hint);
    }
    host.appendChild(tile);
  }
}
