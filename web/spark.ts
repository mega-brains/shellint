/** Inline-SVG line chart. No chart library, no colours — CSS owns the paint. */
const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_W = 100;
const DEFAULT_HEIGHT = 48;
const PAD_X = 1;
const PAD_Y = 3;

export type SparkPoint = { x: number; y: number | null };
export type SparkSeries = { label: string; points: SparkPoint[] };

export type SparkOptions = {
  height?: number;
  formatY?: (y: number) => string;
  formatX?: (x: number) => string;
};

type LivePoint = { x: number; y: number };
type Bounds = { xMin: number; xMax: number; yMin: number; yMax: number };

function isLive(p: SparkPoint): p is LivePoint {
  return p.y !== null && Number.isFinite(p.y) && Number.isFinite(p.x);
}

function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function bounds(series: SparkSeries[]): Bounds | null {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let seen = 0;
  for (const s of series) {
    for (const p of s.points) {
      if (!isLive(p)) continue;
      seen++;
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
  }
  return seen ? { xMin, xMax, yMin, yMax } : null;
}

/** A zero span (flat series, single point) centres instead of dividing by zero. */
function project(p: LivePoint, b: Bounds, height: number): string {
  const spanX = b.xMax - b.xMin;
  const spanY = b.yMax - b.yMin;
  const fx = spanX === 0 ? 0.5 : (p.x - b.xMin) / spanX;
  const fy = spanY === 0 ? 0.5 : (p.y - b.yMin) / spanY;
  const x = PAD_X + fx * (VIEW_W - PAD_X * 2);
  const y = PAD_Y + (1 - fy) * (height - PAD_Y * 2);
  return `${num(x)} ${num(y)}`;
}

function runs(points: SparkPoint[]): LivePoint[][] {
  const out: LivePoint[][] = [];
  let current: LivePoint[] = [];
  for (const p of points) {
    if (isLive(p)) current.push(p);
    else if (current.length) {
      out.push(current);
      current = [];
    }
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * A null y is a dropped sample from a lossy log, not a value: every run of live
 * points opens its own `M` subpath so the gap stays a gap and no segment is
 * drawn across data we never received.
 */
function pathFor(points: SparkPoint[], b: Bounds, height: number): string {
  return runs(points)
    .map((run) => {
      const coords = run.map((p) => project(p, b, height));
      const head = coords[0];
      // A lone sample has no segment; repeating it lets a round cap show a dot.
      const tail = coords.length > 1 ? coords.slice(1) : [head];
      return `M ${head} ${tail.map((c) => `L ${c}`).join(" ")}`;
    })
    .join(" ");
}

/** The `d` attributes a render would emit — lets the gap rule be asserted headlessly. */
export function sparkPaths(series: SparkSeries[], height = DEFAULT_HEIGHT): string[] {
  const b = bounds(series);
  if (!b) return [];
  return series.map((s) => pathFor(s.points, b, height));
}

function seriesName(s: SparkSeries, index: number): string {
  return s.label || `series ${index + 1}`;
}

function summarize(series: SparkSeries[], formatY: (y: number) => string): string {
  const parts = series.map((s, i) => {
    const live = s.points.filter(isLive);
    const name = seriesName(s, i);
    if (!live.length) return `${name}: no data`;
    const last = live[live.length - 1];
    const n = live.length === 1 ? "1 point" : `${live.length} points`;
    return `${name}: last ${formatY(last.y)}, ${n}`;
  });
  return `sparkline — ${parts.join("; ")}`;
}

function labelEl(text: string, extraClass?: string): HTMLElement {
  const el = document.createElement("span");
  el.className = extraClass ? `spark-label ${extraClass}` : "spark-label";
  el.textContent = text;
  return el;
}

function axisEl(labels: string[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "spark-axis";
  for (const text of labels) row.appendChild(labelEl(text));
  return row;
}

function legendEl(series: SparkSeries[]): HTMLElement | null {
  const row = document.createElement("div");
  row.className = "spark-axis";
  series.forEach((s, i) => {
    if (!s.label) return;
    row.appendChild(labelEl(s.label, `spark-line-${i}`));
  });
  return row.childElementCount ? row : null;
}

function svgEl(
  series: SparkSeries[],
  b: Bounds,
  height: number,
  formatY: (y: number) => string,
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "spark");
  svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(height));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", summarize(series, formatY));

  series.forEach((s, i) => {
    const d = pathFor(s.points, b, height);
    if (!d) return;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", `spark-line spark-line-${i}`);
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    // viewBox is stretched on x only, so keep the stroke width uniform.
    path.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(path);
  });
  return svg;
}

/**
 * Compact multi-series line chart: optional legend row, fluid-width SVG, then
 * an axis row of x-first, y-min, y-max, x-last.
 */
export function renderSparkline(
  host: HTMLElement,
  series: SparkSeries[],
  opts: SparkOptions = {},
): void {
  host.replaceChildren();
  const b = bounds(series);
  if (!b) {
    const empty = document.createElement("p");
    empty.className = "spark-empty";
    empty.textContent = "no data yet";
    host.appendChild(empty);
    return;
  }

  const height = opts.height ?? DEFAULT_HEIGHT;
  const formatX = opts.formatX ?? num;
  const formatY = opts.formatY ?? num;

  const legend = legendEl(series);
  if (legend) host.appendChild(legend);
  host.appendChild(svgEl(series, b, height, formatY));
  host.appendChild(
    axisEl([
      formatX(b.xMin),
      formatY(b.yMin),
      formatY(b.yMax),
      formatX(b.xMax),
    ]),
  );
}
