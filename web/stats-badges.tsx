import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { HIGHLIGHT_LINES_EVENT, type LineHighlight } from "./line-highlight";
import { tipStyleFor } from "./option-tip";
import { StatTip, type StatTipContent } from "./stat-tip";
import type { StatSites, StatVariants } from "./stats-model";
import { countersFromBadgeStats } from "./stats-model";

/** Uncapped script counters as a tile grid — no bar, because there is no cap. */
export type BadgeStats = {
  apis: Record<string, number>;
  declarations: { vars: number; functions: number; anonFunctions?: number };
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
  tip: StatTipContent;
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
      tip: {
        name: "api kinds",
        blurb: "Distinct Shelly/Espruino APIs used (member or call sites).",
        metric: "apiKinds",
      },
      lines: sites?.apis,
    },
    {
      value: `${calls}`,
      label: "api calls",
      tip: {
        name: "api calls",
        blurb: "Total call/member sites across those APIs.",
        metric: "apiCalls",
      },
      lines: sites?.apis,
    },
    {
      value: `${stats.declarations.vars}`,
      label: "vars",
      tip: {
        name: "vars",
        blurb: "Top-level and local variable declarations (not for-loop binders).",
        metric: "vars",
      },
      lines: sites?.vars,
    },
    {
      value: `${stats.declarations.functions}`,
      label: "functions",
      tip: {
        name: "functions",
        blurb: "Named function declarations, methods, and named expressions. Anonymous function/arrow count shown alongside when nonzero.",
        metric: "functions",
      },
      lines: sites?.functions,
    },
    {
      value: `${str.count}`,
      label: "strings",
      hint: `${str.totalBytes} B`,
      tip: {
        name: "strings",
        blurb: "String / template literals — count and UTF-8 bytes.",
        metric: "strings",
        showBytes: true,
      },
      lines: sites?.strings,
    },
    {
      value: `${stats.logging.consoleLog}`,
      label: "console.log",
      tip: {
        name: "console.log",
        blurb: "console.log / warn / error call sites (stripped in prod when gated).",
        metric: "consoleLog",
      },
      lines: sites?.consoleLog,
    },
    {
      value: `${stats.logging.print}`,
      label: "print",
      tip: {
        name: "print",
        blurb: "print() call sites — cheaper than console.log on device.",
        metric: "print",
      },
      lines: sites?.print,
    },
    {
      value: `${stats.network.shellyCall}`,
      label: "Shelly.call",
      tip: {
        name: "Shelly.call",
        blurb: "Async RPC calls — the device allows 5 concurrent.",
        metric: "shellyCall",
      },
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

function resolveVariants(
  variants: StatVariants | null | undefined,
  stats: BadgeStats,
): StatVariants {
  if (variants?.source) return variants;
  return { source: countersFromBadgeStats(stats) };
}

export function StatBadges(props: {
  stats: BadgeStats | null | undefined;
  variants?: StatVariants | null;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [tipKey, setTipKey] = useState<string | null>(null);
  const [tipStyle, setTipStyle] = useState<JSX.CSSProperties>({});

  if (!props.stats) {
    return (
      <div id="statBadges" class="stat-badges" aria-label="Script counters">
        <p class="stats-bars-empty">no stats yet — Build to analyze</p>
      </div>
    );
  }

  const variants = resolveVariants(props.variants, props.stats);
  const badges = badgesFrom(props.stats);
  const tipBadge = tipKey ? badges.find((b) => b.label === tipKey) : null;

  const openTip = (label: string, el: HTMLElement) => {
    setTipKey(label);
    setTipStyle(tipStyleFor(el.getBoundingClientRect(), 220));
  };
  const closeTip = () => setTipKey(null);

  const tipHandlers = (label: string) => ({
    onMouseEnter: (e: JSX.TargetedMouseEvent<HTMLElement>) =>
      openTip(label, e.currentTarget),
    onMouseLeave: closeTip,
    onFocus: (e: JSX.TargetedFocusEvent<HTMLElement>) =>
      openTip(label, e.currentTarget),
    onBlur: closeTip,
  });

  return (
    <div id="statBadges" class="stat-badges" aria-label="Script counters">
      {badges.map((badge) => {
        const lines = badge.lines ?? [];
        const key = badge.label;
        const on = active === key;
        const tipId = tipKey === key ? "statTipLive" : undefined;
        if (!lines.length) {
          return (
            <div
              key={key}
              class="stat-badge"
              tabIndex={0}
              aria-describedby={tipId}
              {...tipHandlers(key)}
            >
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
            aria-pressed={on ? "true" : "false"}
            aria-describedby={tipId}
            {...tipHandlers(key)}
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
      {tipBadge ? (
        <StatTip open content={tipBadge.tip} variants={variants} style={tipStyle} />
      ) : null}
      {tipBadge ? (
        <span id="statTipLive" class="visually-hidden">
          {tipBadge.tip.blurb}
        </span>
      ) : null}
    </div>
  );
}
