/**
 * Single source of truth for "which firmware / hardware does this device API
 * need". Consumed by the Tier 4 connected lint (`lint-connected.ts`) and by the
 * minimum-firmware badge (`min-firmware.ts`). Versions come from the changelog
 * table in plan 01 §7.
 */
export type Capability = {
  rule: string;
  label: string;
  /** First firmware that shipped the API — see the changelog table in plan 01. */
  minFw?: string;
  /** AES and ArrayBuffer are Gen3/Gen4 only. */
  minGen?: number;
  /** Namespace that must appear in ListMethods for the feature to exist. */
  requiresMethodPrefix?: string;
};

/** 1.0.0 shipped `Date` and `btoh()`; nothing older is worth targeting. */
export const BASELINE_FIRMWARE = "1.0.0";

export const CAPABILITIES: Record<string, Capability> = {
  aes: {
    rule: "require-capability-aes",
    label: "AES",
    minFw: "1.6.0",
    minGen: 3,
  },
  arrayBuffer: {
    rule: "require-capability-array-buffer",
    label: "ArrayBuffer",
    minFw: "1.6.0",
    minGen: 3,
  },
  storage: {
    rule: "require-capability-storage",
    label: "Script.storage",
    minFw: "1.2.0",
  },
  virtual: {
    rule: "require-capability-virtual",
    label: "the Virtual scripting API",
    minFw: "1.4.0",
    requiresMethodPrefix: "Virtual.",
  },
  metaVc: {
    rule: "require-capability-meta-vc",
    label: "@meta virtual-component declarations",
    minFw: "2.0.0",
  },
  rpcHandler: {
    rule: "require-capability-rpc-handler",
    label: "Script.addRpcHandler",
    minFw: "1.5.0",
  },
  uptimeMs: {
    rule: "require-capability-uptime",
    label: "Shelly.getUptimeMs",
    minFw: "1.5.0",
  },
  timerInfo: {
    rule: "require-capability-timer-info",
    label: "Timer.getInfo",
    minFw: "1.5.0",
  },
  /**
   * A wildcard topic is often a runtime value, so no lint rule enforces this —
   * only the firmware floor, which errs on the side of the newer requirement.
   */
  mqttWildcard: {
    rule: "require-capability-mqtt-wildcard",
    label: "MQTT.subscribe wildcards",
    minFw: "1.1.0",
  },
};

function parseVersion(ver: string | null): number[] | null {
  if (!ver) return null;
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(ver.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** -1 / 0 / 1, or null when the device firmware string is unusable. */
export function compareVersion(ver: string | null, min: string): number | null {
  const a = parseVersion(ver);
  const b = parseVersion(min);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return 0;
}

/** Capability gated by a call/identifier name, or null when unrestricted. */
export function capabilityKeyFor(name: string): string | null {
  if (name.startsWith("AES.")) return "aes";
  if (name.startsWith("Script.storage.")) return "storage";
  if (name.startsWith("Virtual.") || name === "Script.getVcHandle") {
    return "virtual";
  }
  if (name === "Script.addRpcHandler") return "rpcHandler";
  if (name === "Shelly.getUptimeMs") return "uptimeMs";
  if (name === "Timer.getInfo") return "timerInfo";
  return null;
}
