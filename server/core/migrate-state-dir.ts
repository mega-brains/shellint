import { runtime } from "#shellint/runtime";
import { LEGACY_STATE_DIR, STATE_DIR } from "./paths.ts";

let done = false;

/**
 * Move a pre-rename `.devroom/` state dir to `.shellint/`, once.
 *
 * The dir holds `devices.json` — the device list *and* each device's plaintext
 * password at `0600` — plus the per-device profile/probe caches and the build
 * and script history. The rename would otherwise orphan all of it silently: the
 * server would come up device-less and the user would have to know to move it
 * by hand. `rename` keeps the same inode, so ownership and the `0600` mode carry
 * over untouched and no plaintext password is ever copied through a new file.
 *
 * Only ever moves into a *missing* target, so nothing existing can be
 * overwritten and a second call is a no-op. Failure is not fatal — the caller
 * still boots, just device-less, which is the same state as before the move.
 */
export async function migrateStateDir(): Promise<boolean> {
  if (done) return false;
  done = true;
  if (await runtime.fs.exists(STATE_DIR)) return false;
  if (!(await runtime.fs.exists(LEGACY_STATE_DIR))) return false;
  try {
    await runtime.fs.rename(LEGACY_STATE_DIR, STATE_DIR);
  } catch (error) {
    console.warn(
      `shellint: could not move .devroom/ to .shellint/ (${String(error)}) — move it by hand`,
    );
    return false;
  }
  console.warn("shellint: moved legacy .devroom/ state dir to .shellint/");
  return true;
}
