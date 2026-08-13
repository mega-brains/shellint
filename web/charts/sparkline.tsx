import { useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  formatSparkNum,
  sampleAt,
  sparkBounds,
  sparkDefaultHeight,
  sparkGuideX,
  sparkPaths,
  sparkViewW,
  summarizeSpark,
  type SparkOptions,
  type SparkSeries,
} from "./spark";

export type { SparkPoint, SparkSeries, SparkOptions } from "./spark";

/**
 * Compact multi-series line chart: optional legend row, fluid-width SVG, then
 * an axis row of x-first, y-min, y-max, x-last.
 */
export function Sparkline(props: {
  series: SparkSeries[];
  options?: SparkOptions;
  class?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const series = props.series;
  const opts = props.options ?? {};
  const height = opts.height ?? sparkDefaultHeight();
  const formatX = opts.formatX ?? formatSparkNum;
  const formatY = opts.formatY ?? formatSparkNum;
  const b = sparkBounds(series);
  const [tip, setTip] = useState<{
    hidden: boolean;
    left: number;
    flip: boolean;
    rows: { label: string; index: number; text: string }[];
    when: string;
  }>({ hidden: true, left: 0, flip: false, rows: [], when: "" });
  const [guideX, setGuideX] = useState<number | null>(null);

  if (!b) {
    return (
      <div
        id={props.id}
        class={`spark-host${props.class ? ` ${props.class}` : ""}`}
        aria-label={props["aria-label"]}
      >
        <p class="spark-empty">no data yet</p>
      </div>
    );
  }

  const paths = sparkPaths(series, height);
  const legend = series.filter((s) => s.label);

  const onMove = (e: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const fraction = Math.min(
      1,
      Math.max(0, (e.clientX - box.left) / box.width),
    );
    const hit = sampleAt(series, b, fraction);
    if (!hit) return;
    setGuideX(sparkGuideX(fraction));
    const host = e.currentTarget.closest(".spark-host") as HTMLElement | null;
    const left = host
      ? e.clientX - host.getBoundingClientRect().left
      : e.clientX - box.left;
    const rows = hit.readings.map((r) => ({
      label: r.label,
      index: r.index,
      text: r.label ? `${r.label} ${formatY(r.y)}` : formatY(r.y),
    }));
    // Measure tip after paint; approximate flip with host width.
    const tipW = 120;
    const hostW = host?.clientWidth ?? box.width;
    const flip = left > hostW - tipW - 8;
    setTip({
      hidden: false,
      left,
      flip,
      rows,
      when: formatX(hit.x),
    });
  };

  const hide = () => {
    setTip((t) => ({ ...t, hidden: true }));
    setGuideX(null);
  };

  return (
    <div
      id={props.id}
      class={`spark-host${props.class ? ` ${props.class}` : ""}`}
      aria-label={props["aria-label"]}
    >
      {legend.length ? (
        <div class="spark-axis">
          {series.map((s, i) =>
            s.label ? (
              <span key={s.label} class={`spark-label spark-line-${i}`}>
                {s.label}
              </span>
            ) : null,
          )}
        </div>
      ) : null}
      <svg
        class="spark"
        viewBox={`0 0 ${sparkViewW()} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={String(height)}
        role="img"
        aria-label={summarizeSpark(series, formatY)}
        onPointerMove={onMove}
        onPointerLeave={hide}
        onPointerCancel={hide}
      >
        {paths.map((d, i) =>
          d ? (
            <path
              key={i}
              class={`spark-line spark-line-${i}`}
              d={d}
              fill="none"
              vector-effect="non-scaling-stroke"
            />
          ) : null,
        )}
        <line
          class="spark-guide"
          y1="0"
          y2={String(height)}
          x1={guideX == null ? 0 : guideX}
          x2={guideX == null ? 0 : guideX}
          visibility={guideX == null ? "hidden" : "visible"}
        />
      </svg>
      <div
        class="spark-tip"
        hidden={tip.hidden}
        style={{
          left: tip.flip
            ? `${tip.left - 8}px`
            : `${tip.left + 8}px`,
          transform: tip.flip ? "translateX(-100%)" : undefined,
        }}
      >
        {tip.rows.map((r) => (
          <span key={r.index} class={`spark-tip-row spark-line-${r.index}`}>
            {r.text}
          </span>
        ))}
        <span class="spark-tip-x">{tip.when}</span>
      </div>
      <div class="spark-axis">
        <span class="spark-label">{formatX(b.xMin)}</span>
        <span class="spark-label">{formatY(b.yMin)}</span>
        <span class="spark-label">{formatY(b.yMax)}</span>
        <span class="spark-label">{formatX(b.xMax)}</span>
      </div>
    </div>
  );
}
