import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEVICE_PROFILE_PATH } from "./paths.ts";
import { loadConfig, assertDevroomCompiler } from "./config.ts";
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

  const rpc = new ShellyRpc(cfg.deviceIp);
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

    const profile: DeviceProfile = {
      at: new Date().toISOString(),
      deviceIp: cfg.deviceIp,
      gen: typeof info.gen === "number" ? info.gen : null,
      ver: str(info, "ver"),
      model: str(info, "model"),
      app: str(info, "app"),
      methods,
      components,
    };
    writeDeviceProfile(profile);
    return profile;
  } finally {
    rpc.close();
  }
}

export function writeDeviceProfile(profile: DeviceProfile): void {
  mkdirSync(dirname(DEVICE_PROFILE_PATH), { recursive: true });
  writeFileSync(
    DEVICE_PROFILE_PATH,
    JSON.stringify(profile, null, 2) + "\n",
    "utf8",
  );
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
