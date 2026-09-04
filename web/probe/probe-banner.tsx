import type { ProbeState } from "./use-probe-state";
import type { Device } from "../device/use-devices";

export type ProbeBannerProps = {
  state: ProbeState;
  device: Device;
  busy: boolean;
  onRunProbe: () => void;
  onSkip: () => void;
  onRemoveDevice: () => void;
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

  if (props.device.unsupported) {
    const model = props.device.unsupported.model;
    return (
      <div class="import-banner probe-banner probe-banner-required" role="status">
        <span class="import-banner-text">
          <strong>{props.device.label}</strong>{model ? ` (${model})` : ""} is a Gen1 device — no script runtime. shellint needs Gen2 or newer.
        </span>
        <button type="button" class="import-banner-discard" disabled={props.busy} onClick={props.onRemoveDevice}>
          Remove device
        </button>
      </div>
    );
  }

  if (state.skipped && !state.required) {
    return (
      <div class="import-banner probe-banner probe-banner-skipped" role="status">
        <span class="import-banner-text">
          Probe skipped for {state.skipped.ver ?? "unknown firmware"} — findings are advisory.
        </span>
        <button type="button" class="import-banner-discard" disabled={props.busy} onClick={props.onRunProbe}>
          Run probe
        </button>
      </div>
    );
  }

  if (!state.required) return null;

  const fallback = state.newest
    ? ` Capability lint and Deploy use the ${state.newest.ver ?? "unknown"} capture from ${dateOnly(state.newest.at)}.`
    : " Capability lint and Deploy are blocked until it is probed (or skipped).";

  return (
    <div class="import-banner probe-banner probe-banner-required" role="status">
      <span class="import-banner-text">
        <strong>{props.device.label}</strong>{" "}
        {state.ver ? <>runs firmware {state.ver} — {state.reason === "firmware-changed" ? "not probed on this firmware." : "never probed."}</> : <>has not reported a firmware version — shellint has never reached it over Gen2 RPC.</>}
        {state.ver ? fallback : " Capability lint and Deploy stay blocked until it answers (or you skip)."}
      </span>
      <button type="button" class="import-banner-discard" disabled={props.busy} onClick={props.onRunProbe}>
        Run probe
      </button>
      <button type="button" class="import-banner-discard" disabled={props.busy} onClick={props.onSkip}>
        Skip for now
      </button>
    </div>
  );
}
