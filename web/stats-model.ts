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

export function formatEstimate(
  estimate: MemoryEstimate | null | undefined,
): string {
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
export function resolveStats(
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

export function historyTimeLabel(ts: string): string {
  const t = new Date(ts);
  return Number.isNaN(t.getTime())
    ? ts
    : t.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

export function sizeSparkPoints(rows: HistoryRow[]) {
  return [...rows]
    .reverse()
    .map((row) => {
      const bytes = row.sizes.prod.min ?? row.sizes.prod.raw ?? null;
      const at = new Date(row.ts).getTime();
      return { x: Number.isNaN(at) ? 0 : at, y: bytes };
    })
    .filter((p) => p.x > 0);
}

export function memSparkPoints(rows: HistoryRow[]) {
  return [...rows]
    .reverse()
    .map((row) => {
      const at = new Date(row.ts).getTime();
      return { x: Number.isNaN(at) ? 0 : at, y: row.memEstimate ?? null };
    })
    .filter((p) => p.x > 0);
}

export function sparkTimeLabel(x: number): string {
  return new Date(x).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
