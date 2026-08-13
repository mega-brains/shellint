/**
 * Lowest firmware a script can run on, derived from the device APIs it calls.
 * Feeds the dashboard's minimum-firmware badge; the versions themselves live in
 * `capabilities.ts`.
 */
import {
  BASELINE_FIRMWARE,
  CAPABILITIES,
  capabilityKeyFor,
  compareVersion,
} from "../lint/capabilities.ts";

export type MinFirmware = {
  version: string;
  reasons: { api: string; version: string }[];
};

function capabilityFor(api: string): string | null {
  // Lint stays silent on wildcards because the topic is often a runtime value;
  // the firmware floor has to assume the worst instead.
  if (api === "MQTT.subscribe") return "mqttWildcard";
  return capabilityKeyFor(api);
}

/** Firmware an API needs, or null when the baseline already covers it. */
function requiredFirmware(api: string): string | null {
  const key = capabilityFor(api);
  const minFw = key ? CAPABILITIES[key]?.minFw : undefined;
  if (!minFw || compareVersion(minFw, BASELINE_FIRMWARE) !== 1) return null;
  return minFw;
}

/** `apis` is the `ScriptStats.apis` counter map: `{ "Timer.set": 3, … }`. */
export function minFirmware(apis: Record<string, number>): MinFirmware {
  const reasons: MinFirmware["reasons"] = [];
  let version = BASELINE_FIRMWARE;

  for (const [api, count] of Object.entries(apis)) {
    if (count <= 0) continue;
    const required = requiredFirmware(api);
    if (!required) continue;
    reasons.push({ api, version: required });
    if (compareVersion(required, version) === 1) version = required;
  }

  reasons.sort((a, b) => {
    const byVersion = compareVersion(b.version, a.version) ?? 0;
    return byVersion !== 0 ? byVersion : a.api.localeCompare(b.api);
  });

  return { version, reasons };
}
