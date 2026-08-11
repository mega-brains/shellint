import { createCollapsible } from "./collapsible";
import { createLogsPanel } from "./logs-panel";
import {
  updateStatsPanel,
  type HistoryRow,
  type MemoryEstimate,
  type MinFirmware,
  type ScriptStats,
} from "./stats-panel";

type ApiFn = <T>(
  path: string,
  init?: RequestInit,
) => Promise<T & { ok: boolean; error?: string }>;

export type DashboardPatch = {
  stats?: ScriptStats | null;
  history?: HistoryRow[];
  estimate?: MemoryEstimate | null;
  minFirmware?: MinFirmware | null;
  memPeak?: number | null;
};

/**
 * Owns the metric widgets added in M12 — memory estimate, minimum-firmware badge,
 * size sparkline, debug-log panel — including their element lookups, so `main.ts`
 * stays inside the 500-line source cap.
 */
export function createDashboard(opts: {
  api: ApiFn;
  onStatus: (msg: string, isError?: boolean) => void;
}) {
  const byId = (id: string) => document.getElementById(id)!;
  const els = {
    badges: byId("statBadges"),
    chart: byId("statsChart"),
    history: byId("buildHistory"),
    spark: byId("historySpark"),
    memSpark: byId("memSpark"),
    estimate: byId("memEstimate"),
    breakdown: byId("memBreakdown"),
    bullet: byId("memBullet"),
    compare: byId("memCompare"),
    minFw: byId("minFirmware"),
  };

  createCollapsible(
    {
      panel: byId("historyBlock"),
      head: byId("historyHead"),
      toggle: byId("historyToggle"),
    },
    {
      storageKey: "shelly-devroom.historyBlock.collapsed",
      defaultCollapsed: true,
    },
  );

  createLogsPanel({
    els: {
      panel: byId("logsPanel"),
      head: byId("logsHead"),
      toggle: byId("logsToggle"),
      peek: byId("logsPeek"),
      body: byId("logsBody"),
      button: byId("btnLogs") as HTMLButtonElement,
      note: byId("logsNote"),
      spark: byId("logsSpark"),
      list: byId("logsList"),
    },
    api: opts.api,
    onStatus: opts.onStatus,
  });

  const state: DashboardPatch = { history: [] };

  function update(patch: DashboardPatch) {
    Object.assign(state, patch);
    updateStatsPanel({
      badgesEl: els.badges,
      chartEl: els.chart,
      historyEl: els.history,
      sparkEl: els.spark,
      memSparkEl: els.memSpark,
      estimateEl: els.estimate,
      breakdownEl: els.breakdown,
      bulletEl: els.bullet,
      compareEl: els.compare,
      minFwEl: els.minFw,
      stats: state.stats,
      history: state.history ?? [],
      estimate: state.estimate,
      minFirmware: state.minFirmware,
      memPeak: state.memPeak,
    });
  }

  /** Estimate and badge come from the same call that seeds the counters. */
  async function loadStats(): Promise<ScriptStats | null> {
    try {
      const data = await opts.api<{
        stats: ScriptStats;
        estimate: MemoryEstimate;
        minFirmware: MinFirmware;
      }>("/api/stats");
      update({ estimate: data.estimate, minFirmware: data.minFirmware });
      return data.stats;
    } catch {
      return null;
    }
  }

  return { update, loadStats };
}
