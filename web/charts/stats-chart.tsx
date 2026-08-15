import {
  MeasureList,
  MeasureRow,
  WARN_FRACTION,
  type Tone,
} from "../ui/measure";

/** Device caps for Shelly Gen2 resource gauges. */
export const MAX_TIMERS = 5;
export const MAX_ANON_NEST = 3;
export const MAX_HANDLERS = 5;

/** Tier 5 advisory limits — keep in step with ADVISORY_LIMITS in the server. */
export const MAX_LOG_CALLS = 20;
export const MAX_STRING_BYTES = 1024;

export type CapStats = {
  registrations: {
    timers: number;
    eventHandlers: number;
    statusHandlers: number;
    httpEndpoints: number;
    rpcHandlers: number;
  };
  nesting: { maxAnonymousDepth: number };
  literals: { strings: { count: number; totalBytes: number } };
  logging: { consoleLog: number; print: number };
};

type CapRow = {
  label: string;
  used: number;
  max: number;
  soft?: boolean;
  unit?: string;
};

function rowsFromStats(stats: CapStats | null | undefined): CapRow[] {
  if (!stats) return [];
  const r = stats.registrations;
  return [
    { label: "Timer.set", used: r.timers, max: MAX_TIMERS },
    { label: "anon nest", used: stats.nesting.maxAnonymousDepth, max: MAX_ANON_NEST },
    { label: "event handlers", used: r.eventHandlers, max: MAX_HANDLERS },
    { label: "status handlers", used: r.statusHandlers, max: MAX_HANDLERS },
    { label: "http endpoints", used: r.httpEndpoints, max: MAX_HANDLERS },
    { label: "rpc handlers", used: r.rpcHandlers, max: MAX_HANDLERS },
    {
      label: "log calls",
      used: stats.logging.consoleLog + stats.logging.print,
      max: MAX_LOG_CALLS,
      soft: true,
    },
    {
      label: "string bytes",
      used: stats.literals.strings.totalBytes,
      max: MAX_STRING_BYTES,
      soft: true,
      unit: "B",
    },
  ];
}

/**
 * Capped Shelly resources as measure rows — same grammar as artifact sizes and
 * memory buckets, so "how close am I to a wall" reads the same everywhere.
 * Colour only appears at 75% of the limit; over it, the row goes danger.
 */
export function CapMeasures(props: { stats: CapStats | null | undefined }) {
  const rows = rowsFromStats(props.stats);
  if (!rows.length) {
    return <p class="group-empty" id="statsChart">no stats yet — Build to analyze</p>;
  }
  return (
    <MeasureList id="statsChart" labelWidth={104} valueWidth={74}>
      {rows.map((row) => {
        const used = Math.max(0, row.used);
        const max = Math.max(1, row.max);
        const fraction = used / max;
        const tone: Tone =
          used >= max ? "danger" : fraction >= WARN_FRACTION ? "warn" : "accent";
        return (
          <MeasureRow
            key={row.label}
            label={row.label}
            value={row.unit ? `${used}/${max} ${row.unit}` : `${used}/${max}`}
            fraction={fraction}
            tone={tone}
            soft={row.soft}
            ariaLabel={`${row.label} ${used} of ${max}`}
            title={
              row.soft
                ? `${row.label}: ${used} of ${max} before the size advisory warns`
                : `${row.label}: ${used} of the device cap of ${max}`
            }
          />
        );
      })}
    </MeasureList>
  );
}
