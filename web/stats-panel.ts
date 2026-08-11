import { renderStatsBars } from "./stats-chart";
import { renderStatBadges, type StatSites } from "./stats-badges";
import { renderMemBreakdown, renderMemBullet, renderMemPeek } from "./mem-chart";
import { renderSparkline } from "./spark";

export type ScriptStats = {
  apis: Record<string, number>;
  registrations: {
    timers: number;
    eventHandlers: number;
    statusHandlers: number;
    httpEndpoints: number;
    rpcHandlers: number;
  };
  declarations: { vars: number; functions: number };
  literals: { strings: { count: number; totalBytes: number } };
  logging: { consoleLog: number; print: number };
  network: { shellyCall: number };
  nesting: { maxAnonymousDepth: number };
  sites?: StatSites;
};

export type HistoryRow = {
  ts: string;
  sizes: {
    debug: { raw?: number; min?: number; adv?: number };
    prod: { raw?: number; min?: number; adv?: number };
  };
  stats?: {
    apiCalls: number;
    consoleLog: number;
    timers: number;
    anonNest: number;
  };
  memEstimate?: number;
};

export type MemoryEstimate = {
  bytes: number;
  breakdown: Record<string, number>;
};

export type MinFirmware = {
  version: string;
  reasons: { api: string; version: string }[];
};

export function renderHistoryList(host: HTMLElement, rows: HistoryRow[]): void {
  host.replaceChildren();
  if (!rows.length) {
    const li = document.createElement("li");
    li.textContent = "no builds yet";
    host.appendChild(li);
    return;
  }
  for (const row of rows.slice(0, 12)) {
    const li = document.createElement("li");
    const t = new Date(row.ts);
    const when = Number.isNaN(t.getTime())
      ? row.ts
      : t.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
    const d = row.sizes.debug.min ?? row.sizes.debug.raw ?? "—";
    const p = row.sizes.prod.min ?? row.sizes.prod.raw ?? "—";
    li.textContent = `${when}  d ${d} · p ${p}`;
    host.appendChild(li);
  }
}

/** Newest-first rows, plotted oldest-left. Prefer the minified prod artifact. */
export function renderSizeSpark(host: HTMLElement, rows: HistoryRow[]): void {
  const points = [...rows]
    .reverse()
    .map((row) => {
      const bytes = row.sizes.prod.min ?? row.sizes.prod.raw ?? null;
      const at = new Date(row.ts).getTime();
      return { x: Number.isNaN(at) ? 0 : at, y: bytes };
    })
    .filter((p) => p.x > 0);
  renderSparkline(host, [{ label: "prod min", points }], {
    height: 40,
    formatY: (y) => `${y} B`,
    formatX: (x) =>
      new Date(x).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
}

/** Estimated RAM per build, so the cost model can be watched over time. */
export function renderMemSpark(host: HTMLElement, rows: HistoryRow[]): void {
  const points = [...rows]
    .reverse()
    .map((row) => {
      const at = new Date(row.ts).getTime();
      return { x: Number.isNaN(at) ? 0 : at, y: row.memEstimate ?? null };
    })
    .filter((p) => p.x > 0);
  renderSparkline(host, [{ label: "est RAM", points }], {
    height: 32,
    formatY: (y) => `${y} B`,
    formatX: (x) =>
      new Date(x).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
}

export function formatEstimate(estimate: MemoryEstimate | null | undefined): string {
  if (!estimate) return "—";
  return `est RAM ~${estimate.bytes} B`;
}

/**
 * Estimate against the device's own `mem_peak`. Shown as a signed error so the
 * cost model stays honest rather than quietly trusted.
 */
export function formatMemCompare(
  estimate: MemoryEstimate | null | undefined,
  memPeak: number | null | undefined,
): string {
  if (!estimate || memPeak == null || memPeak <= 0) return "";
  const delta = estimate.bytes - memPeak;
  const pct = Math.round((delta / memPeak) * 100);
  const sign = delta > 0 ? "+" : "";
  return `vs peak ${memPeak} B → ${sign}${delta} B (${sign}${pct}%)`;
}

export function formatMinFirmware(min: MinFirmware | null | undefined): string {
  if (!min) return "—";
  if (!min.reasons.length) return `min fw ${min.version} (baseline)`;
  const why = min.reasons
    .slice(0, 2)
    .map((r) => r.api)
    .join(", ");
  return `min fw ${min.version} — ${why}`;
}

/** Prefer live ScriptStats; fall back to latest history summary if needed. */
function resolveStats(
  stats: ScriptStats | null | undefined,
  history: HistoryRow[],
): ScriptStats | null {
  if (stats) return stats;
  const latest = history.find((h) => h.stats);
  if (!latest?.stats) return null;
  return {
    apis: {},
    registrations: {
      timers: latest.stats.timers,
      eventHandlers: 0,
      statusHandlers: 0,
      httpEndpoints: 0,
      rpcHandlers: 0,
    },
    declarations: { vars: 0, functions: 0 },
    literals: { strings: { count: 0, totalBytes: 0 } },
    logging: { consoleLog: latest.stats.consoleLog, print: 0 },
    network: { shellyCall: 0 },
    nesting: { maxAnonymousDepth: latest.stats.anonNest },
  };
}

export function updateStatsPanel(opts: {
  badgesEl: HTMLElement;
  chartEl: HTMLElement;
  historyEl: HTMLElement;
  sparkEl?: HTMLElement;
  memSparkEl?: HTMLElement;
  estimateEl?: HTMLElement;
  breakdownEl?: HTMLElement;
  bulletEl?: HTMLElement;
  memPeekEl?: HTMLElement;
  compareEl?: HTMLElement;
  minFwEl?: HTMLElement;
  stats?: ScriptStats | null;
  history: HistoryRow[];
  estimate?: MemoryEstimate | null;
  minFirmware?: MinFirmware | null;
  memPeak?: number | null;
}): void {
  const resolved = resolveStats(opts.stats, opts.history);
  if (opts.stats !== undefined || resolved) {
    renderStatBadges(opts.badgesEl, resolved);
  }
  renderHistoryList(opts.historyEl, opts.history);
  renderStatsBars(opts.chartEl, resolved);
  if (opts.sparkEl) renderSizeSpark(opts.sparkEl, opts.history);
  if (opts.memSparkEl) renderMemSpark(opts.memSparkEl, opts.history);
  if (opts.estimateEl && opts.estimate !== undefined) {
    opts.estimateEl.textContent = formatEstimate(opts.estimate);
  }
  if (opts.breakdownEl && opts.estimate !== undefined) {
    renderMemBreakdown(opts.breakdownEl, opts.estimate);
  }
  if (opts.bulletEl) {
    renderMemBullet(opts.bulletEl, opts.estimate, opts.memPeak);
  }
  if (opts.memPeekEl) {
    renderMemPeek(opts.memPeekEl, opts.estimate, opts.memPeak);
  }
  if (opts.minFwEl && opts.minFirmware !== undefined) {
    opts.minFwEl.textContent = formatMinFirmware(opts.minFirmware);
  }
  if (opts.compareEl) {
    const text = formatMemCompare(opts.estimate, opts.memPeak);
    opts.compareEl.textContent = text;
    // Over 50% off means the model, not the script, is the thing to distrust.
    const off = text ? Math.abs(Number(text.match(/\(([+-]?\d+)%\)/)?.[1] ?? 0)) : 0;
    opts.compareEl.classList.toggle("warn", off > 50);
  }
}
