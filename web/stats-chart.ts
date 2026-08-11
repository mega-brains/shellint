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
  /** Advisory limits warn about cost; they are not enforced by the firmware. */
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
 * No chart library — plain DOM + CSS.
 */
export function renderStatsBars(
  host: HTMLElement,
  stats: CapStats | null | undefined,
): void {
  host.replaceChildren();
  const rows = rowsFromStats(stats);
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "stats-bars-empty";
    empty.textContent = "no stats yet — Build to analyze";
    host.appendChild(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "stats-bars";

  for (const row of rows) {
    const used = Math.max(0, row.used);
    const max = Math.max(1, row.max);
    const pct = Math.min(100, (used / max) * 100);
    const over = used >= max;

    const li = document.createElement("li");
    li.className = ["stats-bar", over ? "warn" : null, row.soft ? "soft" : null]
      .filter(Boolean)
      .join(" ");
    li.title = row.soft
      ? `${row.label}: ${used} of ${max} before the size advisory warns`
      : `${row.label}: ${used} of the device cap of ${max}`;

    const label = document.createElement("span");
    label.className = "stats-bar-label";
    label.textContent = row.label;
    const value = document.createElement("span");
    value.className = "stats-bar-value";
    value.textContent = row.unit
      ? `${used}/${max} ${row.unit}`
      : `${used}/${max}`;

    const track = document.createElement("div");
    track.className = "stats-bar-track";
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", String(max));
    track.setAttribute("aria-valuenow", String(used));
    track.setAttribute("aria-label", `${row.label} ${used} of ${max}`);

    const fill = document.createElement("div");
    fill.className = "stats-bar-fill";
    fill.style.width = `${pct}%`;
    track.appendChild(fill);

    li.append(label, track, value);
    list.appendChild(li);
  }

  host.appendChild(list);
}
