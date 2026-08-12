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
 * Compact used/max progress bars for capped Shelly resources.
 * No chart library — plain Preact + CSS.
 */
export function StatsBars(props: { stats: CapStats | null | undefined }) {
  const rows = rowsFromStats(props.stats);
  if (!rows.length) {
    return (
      <div
        id="statsChart"
        class="stats-chart"
        aria-label="Resource usage versus Shelly device caps and size advisories"
      >
        <p class="stats-bars-empty">no stats yet — Build to analyze</p>
      </div>
    );
  }

  return (
    <div
      id="statsChart"
      class="stats-chart"
      aria-label="Resource usage versus Shelly device caps and size advisories"
    >
      <ul class="stats-bars">
        {rows.map((row) => {
          const used = Math.max(0, row.used);
          const max = Math.max(1, row.max);
          const pct = Math.min(100, (used / max) * 100);
          const over = used >= max;
          const cls = [
            "stats-bar",
            over ? "warn" : null,
            row.soft ? "soft" : null,
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li
              key={row.label}
              class={cls}
              title={
                row.soft
                  ? `${row.label}: ${used} of ${max} before the size advisory warns`
                  : `${row.label}: ${used} of the device cap of ${max}`
              }
            >
              <span class="stats-bar-label">{row.label}</span>
              <div
                class="stats-bar-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={max}
                aria-valuenow={used}
                aria-label={`${row.label} ${used} of ${max}`}
              >
                <div class="stats-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <span class="stats-bar-value">
                {row.unit ? `${used}/${max} ${row.unit}` : `${used}/${max}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
