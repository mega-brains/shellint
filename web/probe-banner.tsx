import type { ProbeState } from "./use-probe-state";

export type ProbeBannerProps = {
  state: ProbeState;
  deviceLabel: string;
  onRunProbe: () => void;
  onSkip: () => void;
};

function dateOnly(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

/**
 * Probe-required banner (M16 §5) — same slot the slot-import banner uses,
 * above the artifact bar. Server-side enforcement (`deploy.ts`) is the real
 * gate; this only explains it and offers the two ways out: probe, or skip.
 */
export function ProbeBanner(props: ProbeBannerProps) {
  const { state } = props;

  if (state.skipped && !state.required) {
    return (
      <div class="import-banner probe-banner probe-banner-skipped" role="status">
        <span class="import-banner-text">
          Probe skipped for {state.skipped.ver ?? "unknown firmware"} — findings are advisory.
        </span>
        <button type="button" class="import-banner-discard" onClick={props.onRunProbe}>
          Run probe
        </button>
      </div>
    );
  }

  if (!state.required) return null;

  const ver = state.ver ?? "unknown firmware";
  const fallback = state.newest
    ? ` Capability lint and Deploy use the ${state.newest.ver ?? "unknown"} capture from ${dateOnly(state.newest.at)}.`
    : " Capability lint and Deploy are blocked until it is probed (or skipped).";

  return (
    <div class="import-banner probe-banner probe-banner-required" role="status">
      <span class="import-banner-text">
        <strong>{props.deviceLabel}</strong> runs firmware {ver} —{" "}
        {state.reason === "firmware-changed" ? "not probed on this firmware." : "never probed."}
        {fallback}
      </span>
      <button type="button" class="import-banner-discard" onClick={props.onRunProbe}>
        Run probe
      </button>
      <button type="button" class="import-banner-discard" onClick={props.onSkip}>
        Skip for now
      </button>
    </div>
  );
}
