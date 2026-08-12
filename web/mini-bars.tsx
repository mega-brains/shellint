import { useState } from "preact/hooks";
import type { JSX } from "preact";
import type { SparkPoint } from "./spark";

/**
 * A telemetry history as bars, sized to sit inside a telemetry cell: no legend,
 * no axis row. The current value is printed above it, so this only has to show
 * the shape, the spread and the worst sample. Missing samples keep their slot
 * and render as gray hatch so disconnects are obvious.
 */
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

export type MiniBarSlot = {
  x: number;
  width: number;
  height: number;
  y0: number;
  missing: boolean;
};

/** True when a history sample should hatch instead of painting teal. */
export function isMissingSample(y: number | null | undefined): boolean {
  return !(typeof y === "number" && Number.isFinite(y));
}

/**
 * Lay out every history point into a slot — nulls keep their width and use
 * full height so disconnects stay visible between live clusters.
 */
export function layoutMiniBarSlots(
  points: SparkPoint[],
  opts: Pick<MiniBarsOptions, "domainMin" | "domainMax"> = {},
): MiniBarSlot[] {
  if (!points.length) return [];
  const live = points
    .map((p) => p.y)
    .filter((y): y is number => !isMissingSample(y));
  const lo = opts.domainMin ?? 0;
  const hi = opts.domainMax ?? (live.length ? Math.max(...live) : 1);
  const span = hi - lo || 1;
  const slot = VIEW_W / points.length;
  return points.map((p, i) => {
    const missing = isMissingSample(p.y);
    const h = missing
      ? HEIGHT
      : Math.max(1, Math.min(1, Math.max(0, ((p.y as number) - lo) / span)) * HEIGHT);
    return {
      x: i * slot,
      width: Math.max(0.5, slot - GAP),
      height: h,
      y0: HEIGHT - h,
      missing,
    };
  });
}

function clock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Median as well as average: a gap between them means an outlier is skewing it. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/** Diagonal strokes inside a slot — no pattern url, so CSS cannot blank them. */
function HatchMarks(props: { x: number; width: number; height: number }) {
  const { x, width, height } = props;
  const step = 3;
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let t = -height; t < width + height; t += step) {
    lines.push({
      x1: x + t,
      y1: height,
      x2: x + t + height,
      y2: 0,
    });
  }
  return (
    <g class="mini-bar-hatch-marks" aria-hidden="true">
      {lines.map((ln, i) => (
        <line
          key={i}
          class="mini-bar-hatch-line"
          x1={ln.x1}
          y1={ln.y1}
          x2={ln.x2}
          y2={ln.y2}
        />
      ))}
    </g>
  );
}

export function MiniBars(props: {
  points: SparkPoint[];
  options: MiniBarsOptions;
  id?: string;
  class?: string;
  hidden?: boolean;
  "aria-label"?: string;
}) {
  const opts = props.options;
  const points = props.points;
  const live = points.filter(
    (p): p is { x: number; y: number } => !isMissingSample(p.y),
  );
  const [hover, setHover] = useState<string | null>(null);

  if (points.length === 0) {
    return (
      <div
        id={props.id}
        class={`mini-bars-host${props.class ? ` ${props.class}` : ""}`}
        hidden={props.hidden}
        aria-label={props["aria-label"]}
      >
        <p class="mini-bars-note">no data yet</p>
      </div>
    );
  }

  const values = live.map((p) => p.y);
  const slots = layoutMiniBarSlots(points, opts);
  const extreme = values.length
    ? opts.extreme === "min"
      ? Math.min(...values)
      : Math.max(...values)
    : null;
  const avg = values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : null;
  const summary =
    values.length && extreme != null && avg != null
      ? `avg ${avg} · med ${median(values)} · ${opts.extremeLabel ?? "peak"} ${extreme} ${opts.unit}`
      : "no samples in window";
  const label = (p: SparkPoint) =>
    !isMissingSample(p.y)
      ? `${clock(p.x)} · ${p.y} ${opts.unit}`
      : `${clock(p.x)} · missing`;

  const onMove = (e: JSX.TargetedMouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width) return;
    const i = Math.floor(((e.clientX - box.left) / box.width) * points.length);
    const point = points[Math.min(Math.max(0, i), points.length - 1)];
    setHover(label(point));
  };

  const ariaRange = values.length
    ? `${Math.min(...values)} to ${Math.max(...values)} ${opts.unit}`
    : "no live samples";
  const missingCount = slots.filter((s) => s.missing).length;

  return (
    <div
      id={props.id}
      class={`mini-bars-host${props.class ? ` ${props.class}` : ""}`}
      hidden={props.hidden}
      aria-label={props["aria-label"]}
      data-missing-slots={String(missingCount)}
    >
      <svg
        class="mini-bars"
        viewBox={`0 0 ${VIEW_W} ${HEIGHT}`}
        preserveAspectRatio="none"
        width="100%"
        height={String(HEIGHT)}
        role="img"
        aria-label={`${points.length} slots: ${ariaRange}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {slots.map((s, i) => {
          const p = points[i];
          const barW = s.width;
          return (
            <g key={`${p.x}-${i}`}>
              {s.missing ? (
                <svg
                  class="mini-bar-missing"
                  x={s.x}
                  y={0}
                  width={barW}
                  height={HEIGHT}
                  viewBox={`0 0 ${barW} ${HEIGHT}`}
                  overflow="hidden"
                >
                  <rect
                    class="mini-bar missing"
                    x={0}
                    y={0}
                    width={barW}
                    height={HEIGHT}
                  />
                  <HatchMarks x={0} width={barW} height={HEIGHT} />
                </svg>
              ) : (
                <rect
                  class="mini-bar"
                  x={s.x}
                  y={s.y0}
                  width={barW}
                  height={s.height}
                />
              )}
              <rect
                class="mini-bar-hit"
                x={s.x}
                y={0}
                width={Math.max(0.5, s.width + GAP)}
                height={HEIGHT}
              >
                <title>{label(p)}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <p
        class={`mini-bars-note${hover ? " hover" : ""}`}
        title={`${values.length} samples over the last 5 minutes`}
      >
        {hover ?? summary}
      </p>
    </div>
  );
}
