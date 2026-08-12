export type DeviceStatus = {
  deviceIp: string;
  scriptId: number;
  latencyMs: number;
  device: {
    id?: string;
    name?: string;
    model?: string;
    gen?: number | string;
    ver?: string;
    chip: string;
  };
  script: {
    name: string | null;
    running: boolean | null;
    mem_used: number | null;
    mem_peak: number | null;
    mem_free: number | null;
    cpu: number | null;
    errors: unknown[];
  };
  sys: {
    ram_size: number | null;
    ram_free: number | null;
    fs_size: number | null;
    fs_free: number | null;
    restart_required: boolean | null;
  };
  eco_mode: boolean | null;
  temperatureC: number | null;
  temperatureFrom: string | null;
  wifi: { rssi: number | null; ssid: string | null };
};

export type DeviceIdentity = {
  deviceName: string | null;
  scriptName: string | null;
  state: "running" | "stopped" | "unknown" | "offline";
  memPeak: number | null;
};

/** dBm window used to turn RSSI into a 0–1 signal-quality share. */
export const RSSI_FLOOR = -100;
export const RSSI_CEIL = -30;
export const WARN_SHARE = 0.8;

export function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function fmtPair(a: number | null, b: number | null): string {
  if (a == null && b == null) return "—";
  return `${fmtBytes(a)} / ${fmtBytes(b)}`;
}

/** Same pair with the unit stated once — for the width-starved collapsed row. */
export function fmtPairTight(a: number | null, b: number | null): string {
  if (a == null && b == null) return "—";
  const left = fmtBytes(a);
  const right = fmtBytes(b);
  const unit = left.split(" ")[1];
  if (unit && unit === right.split(" ")[1]) {
    return `${left.split(" ")[0]}/${right}`;
  }
  return `${left}/${right}`;
}

/**
 * Fill share for a used/total pair. Bars show the *used* portion even where the
 * label reads "free / size", so a fuller bar always means less headroom.
 */
export function usedShare(
  free: number | null,
  size: number | null,
): number | null {
  if (free == null || size == null || size <= 0) return null;
  return Math.min(1, Math.max(0, (size - free) / size));
}

/**
 * Collapsed summary — the whole body condensed into one row, widest first so
 * the least useful fields are the ones the ellipsis eats on a narrow window.
 */
export function buildPeek(status: DeviceStatus): string {
  const { script, sys, wifi, device } = status;
  const runLabel =
    script.running == null ? "—" : script.running ? "running" : "stopped";
  const parts = [
    device.model,
    device.ver ? `fw ${device.ver}` : null,
    runLabel,
    script.errors.length ? script.errors.join(", ") : null,
    script.mem_used == null && script.mem_peak == null
      ? `mem free ${fmtBytes(script.mem_free)}`
      : `mem ${fmtPairTight(script.mem_used, script.mem_peak)} peak`,
    script.cpu == null ? null : `cpu ${script.cpu}%`,
    `${status.latencyMs} ms`,
    `ram ${fmtPairTight(sys.ram_free, sys.ram_size)}`,
    `fs ${fmtPairTight(sys.fs_free, sys.fs_size)}`,
    status.temperatureC == null
      ? null
      : `${status.temperatureC.toFixed(1)} °C`,
    wifi.rssi == null ? null : `${wifi.rssi} dBm`,
    status.eco_mode == null ? null : `eco ${status.eco_mode ? "on" : "off"}`,
    sys.restart_required ? "restart required" : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export function deviceMetaText(status: DeviceStatus): string {
  const d = status.device;
  const parts = [
    d.model,
    d.chip ? `${d.chip} (inferred)` : null,
    d.ver ? `fw ${d.ver}` : null,
    d.gen != null ? `gen ${d.gen}` : null,
  ].filter(Boolean);
  let text = parts.join(" · ") || "—";
  if (status.sys.restart_required) text += " · restart required";
  return text;
}

export function tempTitle(status: DeviceStatus): string {
  if (status.temperatureC == null) {
    return "no temperature component on this device";
  }
  return status.temperatureFrom === "switch:0"
    ? "internal temperature reported by switch:0"
    : `reported by ${status.temperatureFrom ?? "the device"}`;
}
