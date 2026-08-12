/**
 * Memory estimate visuals: where the estimated JsVar bytes go, and how the
 * estimate lands against the mem_peak the device actually reported.
 */
export type MemoryEstimate = {
  bytes: number;
  breakdown: Record<string, number>;
};

export function MemBreakdown(props: {
  estimate: MemoryEstimate | null | undefined;
}) {
  const entries = Object.entries(props.estimate?.breakdown ?? {})
    .filter(([, bytes]) => bytes > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = props.estimate?.bytes ?? 0;

  if (!entries.length) {
    return (
      <div id="memBreakdown" aria-label="Estimated RAM by cost bucket">
        <p class="stats-bars-empty">no estimate yet — Build to analyze</p>
      </div>
    );
  }

  return (
    <div id="memBreakdown" aria-label="Estimated RAM by cost bucket">
      <ul class="mem-bars">
        {entries.map(([label, bytes]) => {
          const pct = total > 0 ? Math.min(100, (bytes / total) * 100) : 0;
          return (
            <li key={label} class="mem-bar">
              <span class="mem-bar-label">{label}</span>
              <div
                class="mem-bar-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={bytes}
                aria-label={`${label} ${bytes} B of ${total} B estimated`}
              >
                <div class="mem-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <span
                class="mem-bar-value"
                title={`${Math.round(pct)}% of the estimate`}
              >
                {`${bytes} B`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MemPeek(props: {
  estimate: MemoryEstimate | null | undefined;
  memPeak: number | null | undefined;
}) {
  const est = props.estimate?.bytes ?? 0;
  if (!est) {
    return <span class="mem-peek" id="memPeek">—</span>;
  }
  const peak = props.memPeak != null && props.memPeak > 0 ? props.memPeak : null;
  const share = peak ? Math.min(1, est / peak) : null;
  return (
    <span
      class="mem-peek"
      id="memPeek"
      title={
        peak
          ? `estimated ${est} B against the device peak of ${peak} B`
          : `estimated ${est} B, no device peak reported yet`
      }
    >
      <span class="mem-peek-value">{`~${est} B`}</span>
      {share != null ? (
        <span class="mem-peek-track">
          <span
            class="mem-peek-fill"
            style={{ width: `${(share * 100).toFixed(1)}%` }}
          />
        </span>
      ) : null}
    </span>
  );
}

export function MemBullet(props: {
  estimate: MemoryEstimate | null | undefined;
  memPeak: number | null | undefined;
}) {
  const est = props.estimate?.bytes ?? 0;
  if (!est) return <div id="memBullet" />;

  const peak = props.memPeak != null && props.memPeak > 0 ? props.memPeak : null;
  const scale = Math.max(est, peak ?? 0);

  return (
    <div
      id="memBullet"
      title="Estimate versus the mem_peak the device reported for the running script"
    >
      <div
        class="mem-bullet-track"
        role="img"
        aria-label={
          peak
            ? `estimate ${est} B against device peak ${peak} B`
            : `estimate ${est} B, no device peak yet`
        }
      >
        <div
          class="mem-bullet-fill"
          style={{ width: `${(est / scale) * 100}%` }}
          title={`estimate ${est} B`}
        />
        {peak ? (
          <div
            class="mem-bullet-tick"
            style={{ left: `${(peak / scale) * 100}%` }}
            title={`device mem_peak ${peak} B`}
          />
        ) : null}
      </div>
      <p class="mem-bullet-legend">
        {peak
          ? `est ${est} B · peak ${peak} B`
          : `est ${est} B · peak not reported yet`}
      </p>
    </div>
  );
}
