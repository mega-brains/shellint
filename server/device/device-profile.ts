import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEVICE_PROFILE_PATH, devicePaths } from "../core/paths.ts";
import { loadConfig, assertDevroomCompiler } from "../core/config.ts";
import { requireActive, mirrorActiveDevice, toDeviceInfo, touchDeviceInfo } from "./devices.ts";
import { AuthNotSupportedError, ShellyRpc } from "./rpc.ts";

/**
 * What the connected lint knows about the target device. `Shelly.ListMethods`
 * and `Shelly.GetComponents` are the two things no offline linter can have.
 */
export type DeviceProfile = {
  at: string;
  deviceIp: string;
  gen: number | null;
  ver: string | null;
  model: string | null;
  app: string | null;
  methods: string[];
  components: string[];
};

const COMPONENT_PAGE_GUARD = 20;

function str(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" ? v : null;
}

async function fetchComponents(rpc: ShellyRpc): Promise<string[]> {
  const keys: string[] = [];
  let offset = 0;
  for (let page = 0; page < COMPONENT_PAGE_GUARD; page += 1) {
    const res = (await rpc.call("Shelly.GetComponents", { offset })) as {
      components?: { key?: string }[];
      total?: number;
    };
    const batch = res.components ?? [];
    for (const c of batch) {
      if (typeof c.key === "string") keys.push(c.key);
    }
    const total = typeof res.total === "number" ? res.total : keys.length;
    offset += batch.length;
    if (!batch.length || keys.length >= total) break;
  }
  return keys;
}

export async function fetchDeviceProfile(): Promise<DeviceProfile> {
  const cfg = loadConfig();
  assertDevroomCompiler(cfg);
  const target = requireActive();

  const rpc = new ShellyRpc({ ip: target.device.ip, auth: target.device.auth });
  try {
    await rpc.connect();
    const info = ((await rpc.call("Shelly.GetDeviceInfo", {})) ??
      {}) as Record<string, unknown>;
    const listed = ((await rpc.call("Shelly.ListMethods", {})) ?? {}) as {
      methods?: unknown;
    };
    const methods = Array.isArray(listed.methods)
      ? listed.methods.filter((m): m is string => typeof m === "string")
      : [];
    const components = await fetchComponents(rpc);
    touchDeviceInfo(target.device.id, toDeviceInfo(info));

    const profile: DeviceProfile = {
      at: new Date().toISOString(),
      deviceIp: target.device.ip,
      gen: typeof info.gen === "number" ? info.gen : null,
      ver: str(info, "ver"),
      model: str(info, "model"),
      app: str(info, "app"),
      methods,
      components,
    };
    writeDeviceProfile(profile, target.device.id);
    return profile;
  } finally {
    rpc.close();
  }
}

/**
 * Writes the per-device profile (the authoritative copy, under
 * `.devroom/devices/<id>/`) and, since a fresh probe is always for the
 * currently active device, re-mirrors it into `types/device-profile.json`.
 */
export function writeDeviceProfile(profile: DeviceProfile, deviceId: string): void {
  const path = devicePaths(deviceId).profile;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(profile, null, 2) + "\n", "utf8");
  mirrorActiveDevice(deviceId);
}

export function readDeviceProfile(): DeviceProfile | null {
  if (!existsSync(DEVICE_PROFILE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(DEVICE_PROFILE_PATH, "utf8")) as DeviceProfile;
  } catch {
    return null;
  }
}

export { AuthNotSupportedError };
