import type { JSX } from "preact";
import { BodyPortal } from "./option-tip";
import {
  hasDistVariants,
  type StatCounters,
  type StatVariants,
} from "./stats-model";

export type StatMetricKey = keyof StatCounters;

const ROWS: { key: keyof StatVariants; label: string }[] = [
  { key: "source", label: "source" },
  { key: "debugRaw", label: "debug raw" },
  { key: "debugMin", label: "debug min" },
  { key: "prodRaw", label: "prod raw" },
  { key: "prodMin", label: "prod min" },
];

export type StatTipContent = {
  name: string;
  blurb: string;
  metric: StatMetricKey;
  /** For strings: also show bytes under the count. */
  showBytes?: boolean;
};

export type StatTipProps = {
  content: StatTipContent;
  variants: StatVariants | null | undefined;
  style: JSX.CSSProperties;
  open: boolean;
};

function cellText(c: StatCounters | undefined, metric: StatMetricKey, showBytes?: boolean): string {
  if (!c) return "—";
  const n = c[metric];
  if (showBytes && metric === "strings") return `${n} · ${c.stringBytes} B`;
  if (metric === "functions" && c.anonFunctions) return `${n} · ${c.anonFunctions} anon`;
  return String(n);
}

function deltaClass(
  value: number | undefined,
  baseline: number,
): string {
  if (value == null || value === baseline) return "";
  return value > baseline ? " up" : " down";
}

/** Fixed tip: metric blurb + optional source↔dist compare rows. */
export function StatTip(props: StatTipProps) {
  if (!props.open) return null;
  const { content, variants } = props;
  const compare = hasDistVariants(variants);
  const baseline = variants?.source?.[content.metric];

  return (
    <BodyPortal>
      <div
        class="opt-tip stat-tip"
        style={props.style}
        role="tooltip"
        data-testid="stat-tip"
      >
        <p class="opt-tip-name">{content.name}</p>
        <p class="opt-tip-blurb">{content.blurb}</p>
        {!compare || !variants ? (
          <div class="stat-tip-solo">
            <p class="stat-tip-solo-value">
              source{" "}
              <strong>
                {cellText(variants?.source, content.metric, content.showBytes)}
              </strong>
            </p>
            <p class="stat-tip-hint">
              no dist artifacts yet — run Build to compare variants
            </p>
          </div>
        ) : (
          <table class="stat-tip-table">
            <tbody>
              {ROWS.map((row) => {
                const c = variants[row.key];
                const n = c?.[content.metric];
                const delta =
                  row.key === "source" || baseline == null
                    ? ""
                    : deltaClass(n, baseline);
                return (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td class={`stat-tip-cell${delta}`}>
                      {cellText(c, content.metric, content.showBytes)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </BodyPortal>
  );
}
