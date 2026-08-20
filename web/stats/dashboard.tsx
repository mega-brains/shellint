import { flashClass, useChangeFlash } from "../ui/use-flash";
import { Group, MeasureList } from "../ui/measure";
import { StatBadges } from "./stats-badges";
import { CapMeasures } from "../charts/stats-chart";
import { MemMeasures, MemWell } from "../charts/mem-chart";
import { Sparkline } from "../charts/sparkline";
import { api } from "../lib/api";
import { hasAdvColumn, type Sizes } from "../lib/sizes";
import {
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
  type StatVariants,
} from "./stats-model";

export type { HistoryRow, MemoryEstimate, MinFirmware, ScriptStats, StatVariants };

export type DashboardPatch = {
  stats?: ScriptStats | null;
  variants?: StatVariants | null;
  history?: HistoryRow[];
  estimate?: MemoryEstimate | null;
  minFirmware?: MinFirmware | null;
  memPeak?: number | null;
};

export type BuildPanelProps = {
  sizeDebug: Sizes;
  sizeProd: Sizes;
  patch: DashboardPatch;
  /** `"prod.min"` — the artifact the next Deploy would upload, so exactly one
   * bar in the artifacts group carries the accent. */
  target?: string;
};

type Artifact = { key: string; label: string; bytes: number | undefined };

function artifacts(debug: Sizes, prod: Sizes, showAdv: boolean): Artifact[] {
  const out: Artifact[] = [
    { key: "debug.raw", label: "debug raw", bytes: debug.raw },
    { key: "debug.min", label: "debug min", bytes: debug.min },
    { key: "prod.raw", label: "prod raw", bytes: prod.raw },
    { key: "prod.min", label: "prod min", bytes: prod.min },
  ];
  if (showAdv) {
    out.push({ key: "debug.adv", label: "debug adv", bytes: debug.adv });
    out.push({ key: "prod.adv", label: "prod adv", bytes: prod.adv });
  }
  return out;
}

function ArtifactGroup(props: BuildPanelProps) {
  const showAdv = hasAdvColumn(props.sizeDebug, props.sizeProd);
  const rows = artifacts(props.sizeDebug, props.sizeProd, showAdv);
  const largest = Math.max(1, ...rows.map((r) => r.bytes ?? 0));
  const target = props.target ?? "prod.min";
  return (
    <Group title="artifacts" id="sizeBlock" caption={showAdv ? "raw / min / adv" : "bytes"}>
      <MeasureList id="sizeMeasures">
        {rows.map((r) => (
          <ArtifactRow
            key={r.key}
            artifact={r}
            largest={largest}
            target={r.key === target}
          />
        ))}
      </MeasureList>
    </Group>
  );
}

/** Own component so each size gets its own change-flash. */
function ArtifactRow(props: {
  artifact: Artifact;
  largest: number;
  target: boolean;
}) {
  const { artifact, largest, target } = props;
  const flash = useChangeFlash(artifact.bytes);
  return (
    <li
      class={flashClass("measure", flash)}
      id={`size-${artifact.key.replace(".", "-")}`}
      title={
        target
          ? `${artifact.label} — the artifact the next Deploy uploads`
          : artifact.label
      }
    >
      <span class="measure-label">{artifact.label}</span>
      <div
        class="measure-track"
        role="img"
        aria-label={`${artifact.label} ${artifact.bytes ?? "unknown"} bytes`}
      >
        <div
          class={`measure-fill tone-${target ? "accent" : "neutral"}`}
          style={{ width: `${(((artifact.bytes ?? 0) / largest) * 100).toFixed(1)}%` }}
        />
      </div>
      <span class="measure-value">
        {artifact.bytes != null ? `${artifact.bytes} B` : "—"}
      </span>
    </li>
  );
}

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

/** The inspector's build tab: artifacts, counters, caps, memory, history. */
export function BuildPanel(props: BuildPanelProps) {
  const history = props.patch.history ?? [];
  const stats = resolveStats(props.patch.stats, history);
  const firmwareText = formatMinFirmware(props.patch.minFirmware);
  const firmwareFlash = useChangeFlash(firmwareText);

  return (
    <div class="build" id="buildPanel">
      <ArtifactGroup {...props} />

      <Group title="counters" id="statsBlock" caption="source">
        <StatBadges stats={stats} variants={props.patch.variants} />
      </Group>

      <Group title="caps" id="capsBlock" caption="used / limit">
        <CapMeasures stats={stats} />
        <p
          id="minFirmware"
          class={flashClass("group-note", firmwareFlash)}
          title="Lowest Shelly firmware that implements every API this script uses"
        >
          {firmwareText}
        </p>
      </Group>

      <Group
        title="memory estimate"
        id="memBlock"
        caption={
          props.patch.estimate ? `${props.patch.estimate.bytes} B` : "not built"
        }
      >
        <MemMeasures estimate={props.patch.estimate} />
        <MemWell estimate={props.patch.estimate} memPeak={props.patch.memPeak} />
      </Group>

      <Group title="history" id="historyBlock" caption="recent builds">
        <Sparkline
          id="historySpark"
          aria-label="Minified script size over recent builds"
          series={[{ label: "prod min", points: sizeSparkPoints(history) }]}
          options={{ height: 40, formatY: (y) => `${y} B`, formatX: sparkTimeLabel }}
        />
        <Sparkline
          id="memSpark"
          aria-label="Estimated RAM over recent builds"
          series={[{ label: "est RAM", points: memSparkPoints(history) }]}
          options={{ height: 32, formatY: (y) => `${y} B`, formatX: sparkTimeLabel }}
        />
        <HistoryList rows={history} />
      </Group>
    </div>
  );
}

export async function loadStats(): Promise<{
  stats: ScriptStats | null;
  variants?: StatVariants;
  estimate?: MemoryEstimate;
  minFirmware?: MinFirmware;
}> {
  try {
    const data = await api<{
      stats: ScriptStats;
      variants: StatVariants;
      estimate: MemoryEstimate;
      minFirmware: MinFirmware;
    }>("/api/stats");
    return {
      stats: data.stats,
      variants: data.variants,
      estimate: data.estimate,
      minFirmware: data.minFirmware,
    };
  } catch {
    return { stats: null };
  }
}
