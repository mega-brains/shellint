/**
 * Memory estimate visuals: where the estimated JsVar bytes go, and how the
 * estimate lands against the mem_peak the device actually reported.
 */
export type MemoryEstimate = {
  bytes: number;
  breakdown: Record<string, number>;
};

function bar(label: string, bytes: number, total: number): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "mem-bar";

  const name = document.createElement("span");
  name.className = "mem-bar-label";
  name.textContent = label;

  const track = document.createElement("div");
  track.className = "mem-bar-track";
  const pct = total > 0 ? Math.min(100, (bytes / total) * 100) : 0;
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", String(total));
  track.setAttribute("aria-valuenow", String(bytes));
  track.setAttribute(
    "aria-label",
    `${label} ${bytes} B of ${total} B estimated`,
  );

  const fill = document.createElement("div");
  fill.className = "mem-bar-fill";
  fill.style.width = `${pct}%`;
  track.appendChild(fill);

  const value = document.createElement("span");
  value.className = "mem-bar-value";
  value.textContent = `${bytes} B`;
  value.title = `${Math.round(pct)}% of the estimate`;

  li.append(name, track, value);
  return li;
}

/** Cost buckets ranked by weight, each bar a share of the total estimate. */
export function renderMemBreakdown(
  host: HTMLElement,
  estimate: MemoryEstimate | null | undefined,
): void {
  host.replaceChildren();
  const entries = Object.entries(estimate?.breakdown ?? {})
    .filter(([, bytes]) => bytes > 0)
    .sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "stats-bars-empty";
    empty.textContent = "no estimate yet — Build to analyze";
    host.appendChild(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "mem-bars";
  const total = estimate?.bytes ?? 0;
  for (const [label, bytes] of entries) list.appendChild(bar(label, bytes, total));
  host.appendChild(list);
}

/**
 * Collapsed summary: the estimate, and how much of the device's measured peak
 * it accounts for. Same two numbers the bullet bar shows, at header size.
 */
export function renderMemPeek(
  host: HTMLElement,
  estimate: MemoryEstimate | null | undefined,
  memPeak: number | null | undefined,
): void {
  host.replaceChildren();
  const est = estimate?.bytes ?? 0;
  if (!est) {
    host.textContent = "—";
    return;
  }

  const peak = memPeak != null && memPeak > 0 ? memPeak : null;
  const value = document.createElement("span");
  value.className = "mem-peek-value";
  value.textContent = `~${est} B`;
  host.appendChild(value);

  if (!peak) {
    host.title = `estimated ${est} B, no device peak reported yet`;
    return;
  }

  const share = Math.min(1, est / peak);
  const track = document.createElement("span");
  track.className = "mem-peek-track";
  const fill = document.createElement("span");
  fill.className = "mem-peek-fill";
  fill.style.width = `${(share * 100).toFixed(1)}%`;
  track.appendChild(fill);
  host.appendChild(track);
  host.title = `estimated ${est} B against the device peak of ${peak} B`;
}

/**
 * Bullet bar: the fill is the static estimate, the tick is the device's
 * mem_peak. Both are scaled to whichever is larger, so the gap between the
 * cost model and reality is the thing you actually see.
 */
export function renderMemBullet(
  host: HTMLElement,
  estimate: MemoryEstimate | null | undefined,
  memPeak: number | null | undefined,
): void {
  host.replaceChildren();
  const est = estimate?.bytes ?? 0;
  if (!est) return;

  const peak = memPeak != null && memPeak > 0 ? memPeak : null;
  const scale = Math.max(est, peak ?? 0);

  const track = document.createElement("div");
  track.className = "mem-bullet-track";
  track.setAttribute("role", "img");
  track.setAttribute(
    "aria-label",
    peak
      ? `estimate ${est} B against device peak ${peak} B`
      : `estimate ${est} B, no device peak yet`,
  );

  const fill = document.createElement("div");
  fill.className = "mem-bullet-fill";
  fill.style.width = `${(est / scale) * 100}%`;
  fill.title = `estimate ${est} B`;
  track.appendChild(fill);

  if (peak) {
    const tick = document.createElement("div");
    tick.className = "mem-bullet-tick";
    tick.style.left = `${(peak / scale) * 100}%`;
    tick.title = `device mem_peak ${peak} B`;
    track.appendChild(tick);
  }

  const legend = document.createElement("p");
  legend.className = "mem-bullet-legend";
  legend.textContent = peak
    ? `est ${est} B · peak ${peak} B`
    : `est ${est} B · peak not reported yet`;

  host.append(track, legend);
}
