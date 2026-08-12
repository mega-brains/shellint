import { Collapsible } from "./collapsible";
import { StatBadges } from "./stats-badges";
import { StatsBars } from "./stats-chart";
import { MemBreakdown, MemBullet, MemPeek } from "./mem-chart";
import { Sparkline } from "./sparkline";
import { api } from "./api";
import {
  formatEstimate,
  formatMemCompare,
  formatMinFirmware,
  historyTimeLabel,
  memSparkPoints,
  resolveStats,
  sizeSparkPoints,
  sparkTimeLabel,
  type HistoryRow,
  type MemoryEstimate,
  type MinFirmware,
  type ScriptStats,
} from "./stats-model";

export type { HistoryRow, MemoryEstimate, MinFirmware, ScriptStats };

export type DashboardPatch = {
  stats?: ScriptStats | null;
  history?: HistoryRow[];
  estimate?: MemoryEstimate | null;
  minFirmware?: MinFirmware | null;
  memPeak?: number | null;
};

export type BuildPanelProps = {
  sizeDebug: string;
  sizeProd: string;
  patch: DashboardPatch;
};

function HistoryList(props: { rows: HistoryRow[] }) {
  if (!props.rows.length) {
    return (
      <ol id="buildHistory" class="history-list">
        <li>no builds yet</li>
      </ol>
    );
  }
  return (
    <ol id="buildHistory" class="history-list">
      {props.rows.slice(0, 12).map((row) => {
        const d = row.sizes.debug.min ?? row.sizes.debug.raw ?? "—";
        const p = row.sizes.prod.min ?? row.sizes.prod.raw ?? "—";
        return (
          <li key={row.ts}>{`${historyTimeLabel(row.ts)}  d ${d} · p ${p}`}</li>
        );
      })}
    </ol>
  );
}

export function BuildPanel(props: BuildPanelProps) {
  const history = props.patch.history ?? [];
  const stats = resolveStats(props.patch.stats, history);
  const compare = formatMemCompare(props.patch.estimate, props.patch.memPeak);
  const off = compare
    ? Math.abs(Number(compare.match(/\(([+-]?\d+)%\)/)?.[1] ?? 0))
    : 0;

  return (
    <Collapsible
      storageKey="shelly-devroom.buildPanel.collapsed"
      defaultCollapsed={false}
      panelId="buildPanel"
      panelClass="build"
      bodyId="buildBody"
      headId="buildHead"
      toggleId="buildToggle"
      title="Show or hide build sizes, script stats and history"
      ariaLabel="Build sizes"
      headChildren={<h2>build</h2>}
    >
      <div class="sizes" id="buildBody">
        <div class="size-block">
          <h2>debug</h2>
          <p id="sizeDebug">{props.sizeDebug}</p>
        </div>
        <div class="size-block">
          <h2>prod</h2>
          <p id="sizeProd">{props.sizeProd}</p>
        </div>
        <div class="size-block size-stats">
          <h2>stats</h2>
          <StatBadges stats={stats} />
          <StatsBars stats={stats} />
          <p
            id="minFirmware"
            class="stats-summary"
            title="Lowest Shelly firmware that implements every API this script uses"
          >
            {formatMinFirmware(props.patch.minFirmware)}
          </p>
        </div>
        <Collapsible
          as="div"
          storageKey="shelly-devroom.memBlock.collapsed"
          defaultCollapsed={false}
          panelId="memBlock"
          panelClass="size-block size-mem"
          bodyId="memBody"
          headId="memHead"
          toggleId="memToggle"
          title="Show or hide the RAM estimate breakdown"
          headChildren={
            <>
              <h2>memory</h2>
              <MemPeek
                estimate={props.patch.estimate}
                memPeak={props.patch.memPeak}
              />
            </>
          }
        >
          <div class="size-mem-body" id="memBody">
            <p
              id="memEstimate"
              class="mem-total"
              title="Static RAM estimate from an Espruino JsVar cost model — an estimate, not a measurement"
            >
              {formatEstimate(props.patch.estimate)}
            </p>
            <MemBreakdown estimate={props.patch.estimate} />
            <MemBullet
              estimate={props.patch.estimate}
              memPeak={props.patch.memPeak}
            />
            <p
              id="memCompare"
              class={`mem-compare${off > 50 ? " warn" : ""}`}
            >
              {compare}
            </p>
          </div>
        </Collapsible>
        <Collapsible
          as="div"
          storageKey="shelly-devroom.historyBlock.collapsed"
          defaultCollapsed={true}
          panelId="historyBlock"
          panelClass="size-block size-history"
          bodyId="historyBody"
          headId="historyHead"
          toggleId="historyToggle"
          title="Show or hide the size and RAM trends and the per-build list"
          headChildren={<h2>history</h2>}
        >
          <div class="size-history-body" id="historyBody">
            <Sparkline
              id="historySpark"
              aria-label="Minified script size over recent builds"
              series={[{ label: "prod min", points: sizeSparkPoints(history) }]}
              options={{
                height: 40,
                formatY: (y) => `${y} B`,
                formatX: sparkTimeLabel,
              }}
            />
            <Sparkline
              id="memSpark"
              aria-label="Estimated RAM over recent builds"
              series={[{ label: "est RAM", points: memSparkPoints(history) }]}
              options={{
                height: 32,
                formatY: (y) => `${y} B`,
                formatX: sparkTimeLabel,
              }}
            />
            <HistoryList rows={history} />
          </div>
        </Collapsible>
      </div>
    </Collapsible>
  );
}

export async function loadStats(): Promise<{
  stats: ScriptStats | null;
  estimate?: MemoryEstimate;
  minFirmware?: MinFirmware;
}> {
  try {
    const data = await api<{
      stats: ScriptStats;
      estimate: MemoryEstimate;
      minFirmware: MinFirmware;
    }>("/api/stats");
    return {
      stats: data.stats,
      estimate: data.estimate,
      minFirmware: data.minFirmware,
    };
  } catch {
    return { stats: null };
  }
}
