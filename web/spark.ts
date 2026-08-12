/** Inline-SVG line chart geometry — CSS owns the paint; Preact owns the DOM. */
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

export type SparkBounds = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

type LivePoint = { x: number; y: number };

function isLive(p: SparkPoint): p is LivePoint {
  return p.y !== null && Number.isFinite(p.y) && Number.isFinite(p.x);
}

function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}

export function sparkBounds(series: SparkSeries[]): SparkBounds | null {
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

/** Nearest live sample of each series to a fraction along the x axis. */
export function sampleAt(
  series: SparkSeries[],
  b: SparkBounds,
  fraction: number,
): { x: number; readings: { label: string; index: number; y: number }[] } | null {
  const target = b.xMin + fraction * (b.xMax - b.xMin);
  let x: number | null = null;
  const readings: { label: string; index: number; y: number }[] = [];

  series.forEach((s, index) => {
    let best: LivePoint | null = null;
    for (const p of s.points) {
      if (!isLive(p)) continue;
      if (!best || Math.abs(p.x - target) < Math.abs(best.x - target)) best = p;
    }
    if (!best) return;
    readings.push({ label: s.label, index, y: best.y });
    if (x === null) x = best.x;
  });

  return readings.length ? { x: x ?? target, readings } : null;
}

/** A zero span (flat series, single point) centres instead of dividing by zero. */
function project(p: LivePoint, b: SparkBounds, height: number): string {
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

function pathFor(points: SparkPoint[], b: SparkBounds, height: number): string {
  return runs(points)
    .map((run) => {
      const coords = run.map((p) => project(p, b, height));
      const head = coords[0];
      const tail = coords.length > 1 ? coords.slice(1) : [head];
      return `M ${head} ${tail.map((c) => `L ${c}`).join(" ")}`;
    })
    .join(" ");
}

/** The `d` attributes a render would emit — lets the gap rule be asserted headlessly. */
export function sparkPaths(
  series: SparkSeries[],
  height = DEFAULT_HEIGHT,
): string[] {
  const b = sparkBounds(series);
  if (!b) return [];
  return series.map((s) => pathFor(s.points, b, height));
}

export function sparkGuideX(fraction: number): number {
  return PAD_X + fraction * (VIEW_W - PAD_X * 2);
}

export function sparkViewW(): number {
  return VIEW_W;
}

export function sparkDefaultHeight(): number {
  return DEFAULT_HEIGHT;
}

export function formatSparkNum(v: number): string {
  return num(v);
}

export function seriesName(s: SparkSeries, index: number): string {
  return s.label || `series ${index + 1}`;
}

export function summarizeSpark(
  series: SparkSeries[],
  formatY: (y: number) => string,
): string {
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

export { isLive };
