import { runtime } from "#shellint/runtime";

const { join } = runtime.path;

/** Repo root. Both server runtimes launch from this directory. */
export const ROOT = runtime.process.cwd;

/**
 * Absolute-or-root-relative env override. Tests and e2e point the server at a
 * fixture workspace (`fixtures/device/main.ts` copied under `.tmp/`) so no gate
 * step reads or writes the user's live `scripts/main.ts` — see
 * `scripts/fixture-workspace.mjs`.
 */
function fromEnv(name: string, fallback: string): string {
  const raw = runtime.process.env[name]?.trim();
  if (!raw) return fallback;
  return runtime.path.isAbsolute(raw) ? raw : join(ROOT, raw);
}

export const SCRIPT_PATH = fromEnv("SHELLINT_SCRIPT", join(ROOT, "scripts", "main.ts"));
export const DIST_DIR = fromEnv("SHELLINT_DIST", join(ROOT, "dist"));

/**
 * How the script is named in findings and check-pane copy. Relative to ROOT
 * when it lives inside it (the normal case and the fixture workspace alike),
 * absolute otherwise.
 */
export const SCRIPT_LABEL = (() => {
  const rel = runtime.path.relative(ROOT, SCRIPT_PATH);
  return rel && !rel.startsWith("..") ? rel : SCRIPT_PATH;
})();
export const WEB_DIR = join(ROOT, "web");
export const PROBE_PATH = join(ROOT, "types", "generated-probe.json");
export const DEVICE_PROFILE_PATH = join(ROOT, "types", "device-profile.json");
export const SHELLINT_JSON = join(ROOT, "shellint.json");
export const LEGACY_CONFIG_JSON = join(ROOT, "devroom.json");

/**
 * Local state dir: the device list with its plaintext passwords (`0600`), the
 * per-device profile/probe caches and the build/script history. Never tracked.
 * `LEGACY_STATE_DIR` is the pre-rename name, moved across once by
 * `migrateStateDir()` — orphaning it would lose the user's devices.
 */
export const STATE_DIR = join(ROOT, ".shellint");
export const LEGACY_STATE_DIR = join(ROOT, ".devroom");

/**
 * Per-device state dir — the authoritative copy of a device's capability
 * profile/probe. `types/device-profile.json` and `types/generated-probe.json`
 * are mirrors of whichever device is active, rewritten on switch (M15 §3.2).
 * `probe` is the legacy single-capture file (read-only after migration);
 * `probesDir` holds one capture per firmware (`<verKey>.json`, M16 §3.1).
 */
export function devicePaths(id: string): { profile: string; probe: string; probesDir: string } {
  const dir = join(STATE_DIR, "devices", id);
  return {
    profile: join(dir, "profile.json"),
    probe: join(dir, "probe.json"),
    probesDir: join(dir, "probes"),
  };
}
