import { useState } from "preact/hooks";
import { HIGHLIGHT_LINES_EVENT, type LineHighlight } from "./line-highlight";
import type { StatSites } from "./stats-model";

/** Uncapped script counters as a tile grid — no bar, because there is no cap. */
export type BadgeStats = {
  apis: Record<string, number>;
  declarations: { vars: number; functions: number };
  literals: { strings: { count: number; totalBytes: number } };
  logging: { consoleLog: number; print: number };
  network: { shellyCall: number };
  sites?: StatSites;
};

export type { StatSites };

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

export function StatBadges(props: { stats: BadgeStats | null | undefined }) {
  const [active, setActive] = useState<string | null>(null);

  if (!props.stats) {
    return (
      <div id="statBadges" class="stat-badges" aria-label="Script counters">
        <p class="stats-bars-empty">no stats yet — Build to analyze</p>
      </div>
    );
  }

  return (
    <div id="statBadges" class="stat-badges" aria-label="Script counters">
      {badgesFrom(props.stats).map((badge) => {
        const lines = badge.lines ?? [];
        const key = badge.label;
        const on = active === key;
        const title = lines.length
          ? `${badge.title}\nclick to highlight the ${lines.length} line${lines.length === 1 ? "" : "s"} in the editor`
          : badge.title;
        if (!lines.length) {
          return (
            <div key={key} class="stat-badge" title={title}>
              <span class="stat-badge-value">{badge.value}</span>
              <span class="stat-badge-label">{badge.label}</span>
              {badge.hint ? (
                <span class="stat-badge-hint">{badge.hint}</span>
              ) : null}
            </div>
          );
        }
        return (
          <button
            key={key}
            type="button"
            class={`stat-badge clickable${on ? " active" : ""}`}
            title={title}
            aria-pressed={on ? "true" : "false"}
            onClick={() => {
              const next = on ? null : key;
              setActive(next);
              highlight(next ? lines : []);
            }}
          >
            <span class="stat-badge-value">{badge.value}</span>
            <span class="stat-badge-label">{badge.label}</span>
            {badge.hint ? (
              <span class="stat-badge-hint">{badge.hint}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
