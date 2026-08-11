import type { SparkPoint } from "./spark";

/**
 * A telemetry history as bars, sized to sit inside a telemetry cell: no legend,
 * no axis row. The current value is printed above it, so this only has to show
 * the shape, the spread and the worst sample.
 */
const SVG_NS = "http://www.w3.org/2000/svg";
/** x is stretched to the cell width; bar geometry is computed in these units. */
const VIEW_W = 240;
const HEIGHT = 20;
const GAP = 0.35;

export type MiniBarsOptions = {
  unit: string;
  /** Value drawn as a zero-height bar. Defaults to 0 — right for latency. */
  domainMin?: number;
  /** Value drawn full height. Defaults to the largest sample. */
  domainMax?: number;
  /** Which extreme is the interesting one, and what to call it. */
  extreme?: "max" | "min";
  extremeLabel?: string;
};

/** Median as well as average: a gap between them means an outlier is skewing it. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

export function renderMiniBars(
  host: HTMLElement,
  points: SparkPoint[],
  opts: MiniBarsOptions,
): void {
  host.replaceChildren();
  const live = points.filter(
    (p): p is { x: number; y: number } => typeof p.y === "number",
  );
  if (live.length === 0) {
    const empty = document.createElement("p");
    empty.className = "mini-bars-note";
    empty.textContent = "no data yet";
    host.appendChild(empty);
    return;
  }

  const values = live.map((p) => p.y);
  const lo = opts.domainMin ?? 0;
  const hi = opts.domainMax ?? Math.max(...values);
  const span = hi - lo || 1;
  const slot = VIEW_W / live.length;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "mini-bars");
  svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${HEIGHT}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(HEIGHT));
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${live.length} samples: ${Math.min(...values)} to ${Math.max(...values)} ${opts.unit}`,
  );

  live.forEach((p, i) => {
    const share = Math.min(1, Math.max(0, (p.y - lo) / span));
    const h = Math.max(1, share * HEIGHT);
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("class", "mini-bar");
    rect.setAttribute("x", String(i * slot));
    rect.setAttribute("y", String(HEIGHT - h));
    rect.setAttribute("width", String(Math.max(0.5, slot - GAP)));
    rect.setAttribute("height", String(h));
    svg.appendChild(rect);
  });
  host.appendChild(svg);

  const extreme =
    opts.extreme === "min" ? Math.min(...values) : Math.max(...values);
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const stats = document.createElement("p");
  stats.className = "mini-bars-note";
  stats.textContent = `avg ${avg} · med ${median(values)} · ${opts.extremeLabel ?? "peak"} ${extreme} ${opts.unit}`;
  stats.title = `${values.length} samples over the last 5 minutes`;
  host.appendChild(stats);
}
