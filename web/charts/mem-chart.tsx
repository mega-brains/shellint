/**
 * Memory estimate visuals: where the estimated JsVar bytes go, and how the
 * estimate lands against the mem_peak the device actually reported.
 */
import { MeasureList, MeasureRow } from "../ui/measure";

export type MemoryEstimate = {
  bytes: number;
  breakdown: Record<string, number>;
};

export function MemMeasures(props: {
  estimate: MemoryEstimate | null | undefined;
}) {
  const entries = Object.entries(props.estimate?.breakdown ?? {})
    .filter(([, bytes]) => bytes > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = props.estimate?.bytes ?? 0;

  if (!entries.length) {
    return (
      <p class="group-empty" id="memBreakdown">
        no estimate yet — Build to analyze
      </p>
    );
  }

  // Scaled to the largest bucket, not to the total: the point of the group is
  // which bucket dominates, and a share-of-total scale flattens all of them.
  const largest = Math.max(1, ...entries.map(([, bytes]) => bytes));
  return (
    <MeasureList id="memBreakdown">
      {entries.map(([label, bytes]) => (
        <MeasureRow
          key={label}
          label={label}
          value={`${bytes} B`}
          fraction={bytes / largest}
          ariaLabel={`${label} ${bytes} B of ${total} B estimated`}
          title={`${Math.round((bytes / (total || 1)) * 100)}% of the estimate`}
        />
      ))}
    </MeasureList>
  );
}

function pct(n: number): string {
  return `${n > 0 ? "+" : ""}${n}%`;
}

/**
 * Estimate versus the device's reported peak, in one well: the delta in words,
 * a track whose fill is the peak's share of the larger of the two, and a tick
 * where the peak sits. Without a device (static build) it says so rather than
 * drawing a tick at zero.
 */
export function MemWell(props: {
  estimate: MemoryEstimate | null | undefined;
  memPeak: number | null | undefined;
}) {
  const est = props.estimate?.bytes ?? 0;
  const peak = props.memPeak != null && props.memPeak > 0 ? props.memPeak : null;
  if (!est) return <div class="well" id="memWell" hidden />;

  const scale = Math.max(est, peak ?? 0) || 1;
  const delta = peak == null ? null : est - peak;
  const deltaPct = peak == null ? 0 : Math.round(((est - peak) / peak) * 100);
  const over = delta != null && delta > 0;

  return (
    <div
      class="well"
      id="memWell"
      title="Estimate versus the mem_peak the device reported for the running script"
    >
      <div class="well-head">
        <span class="well-label">estimate vs device peak</span>
        <span class={`well-delta${over ? " warn" : ""}`} id="memCompare">
          {delta == null
            ? "peak not reported"
            : `${delta > 0 ? "+" : ""}${delta} B · ${pct(deltaPct)}`}
        </span>
      </div>
      <div
        class="well-track"
        role="img"
        aria-label={
          peak
            ? `estimate ${est} B against device peak ${peak} B`
            : `estimate ${est} B, no device peak yet`
        }
      >
        {/* Without a device peak there is nothing to compare against, so the
            fill goes neutral rather than reading as a full accent bar. */}
        <div
          class={`well-fill${peak ? "" : " tone-neutral"}`}
          style={{ width: `${((peak ?? est) / scale) * 100}%` }}
        />
        {peak ? (
          <div class="well-tick" style={{ left: `${(peak / scale) * 100}%` }} />
        ) : null}
      </div>
      <div class="well-legend">
        <span>{peak ? `peak ${peak} B` : "peak not reported"}</span>
        <span id="memEstimate">
          {peak ? `est ${est} B` : `est ${est} B · attach a device to compare`}
        </span>
      </div>
    </div>
  );
}
