import {
  MAX_ANON_NEST,
  MAX_TIMERS,
  renderStatsBars,
} from "./stats-chart";

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
};

export type HistoryRow = {
  ts: string;
  sizes: {
    debug: { raw?: number; min?: number };
    prod: { raw?: number; min?: number };
  };
  stats?: {
    apiCalls: number;
    consoleLog: number;
    timers: number;
    anonNest: number;
  };
};

export function formatStats(stats: ScriptStats | null | undefined): string {
  if (!stats) return "—";
  const apiN = Object.keys(stats.apis).length;
  const apiCalls = Object.values(stats.apis).reduce((a, b) => a + b, 0);
  const r = stats.registrations;
  return [
    `apis ${apiN} kinds / ${apiCalls} calls · vars ${stats.declarations.vars} · fn ${stats.declarations.functions}`,
    `str ${stats.literals.strings.count} (${stats.literals.strings.totalBytes} B) · log ${stats.logging.consoleLog} · print ${stats.logging.print}`,
    `Timer.set ${r.timers}/${MAX_TIMERS} · Shelly.call ${stats.network.shellyCall} · anon nest ${stats.nesting.maxAnonymousDepth}/${MAX_ANON_NEST}`,
  ].join("\n");
}

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
  summaryEl: HTMLElement;
  chartEl: HTMLElement;
  historyEl: HTMLElement;
  stats?: ScriptStats | null;
  history: HistoryRow[];
}): void {
  const resolved = resolveStats(opts.stats, opts.history);
  if (opts.stats !== undefined || resolved) {
    opts.summaryEl.textContent = formatStats(resolved);
  }
  renderHistoryList(opts.historyEl, opts.history);
  renderStatsBars(opts.chartEl, resolved);
}
