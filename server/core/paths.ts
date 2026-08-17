import { runtime } from "#devroom/runtime";

const { join } = runtime.path;

/** Repo root. Both server runtimes launch from this directory. */
export const ROOT = runtime.process.cwd;

export const SCRIPT_PATH = join(ROOT, "scripts", "main.ts");
export const DIST_DIR = join(ROOT, "dist");
export const WEB_DIR = join(ROOT, "web");
export const PROBE_PATH = join(ROOT, "types", "generated-probe.json");
export const DEVICE_PROFILE_PATH = join(ROOT, "types", "device-profile.json");
export const DEVROOM_JSON = join(ROOT, "devroom.json");

/**
 * Per-device state dir — the authoritative copy of a device's capability
 * profile/probe. `types/device-profile.json` and `types/generated-probe.json`
 * are mirrors of whichever device is active, rewritten on switch (M15 §3.2).
 * `probe` is the legacy single-capture file (read-only after migration);
 * `probesDir` holds one capture per firmware (`<verKey>.json`, M16 §3.1).
 */
export function devicePaths(id: string): { profile: string; probe: string; probesDir: string } {
  const dir = join(ROOT, ".devroom", "devices", id);
  return {
    profile: join(dir, "profile.json"),
    probe: join(dir, "probe.json"),
    probesDir: join(dir, "probes"),
  };
}
