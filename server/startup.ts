import { createApp } from "./app.ts";
import { loadConfig } from "./core/config.ts";
import { ensureMainScript } from "./core/ensure-main-script.ts";
import { materialiseEmbeddedFiles } from "./core/embedded-assets.ts";
import { migrateStateDir } from "./core/migrate-state-dir.ts";
import { ROOT } from "./core/paths.ts";
import { requireActive } from "./device/devices.ts";
import { runtime } from "#shellint/runtime";

async function activeSummary(): Promise<string> {
  try {
    const target = await requireActive();
    return `device ${target.device.label} (${target.device.ip}) · slot ${target.slot}`;
  } catch {
    return "no device selected — add one from UI";
  }
}

export async function prepareStartup() {
  // First, and before anything can create `.shellint/` for another purpose:
  // the move only runs into a missing target, so a history write that got there
  // first would strand the device list in `.devroom/`.
  await migrateStateDir();
  // Before ensureMainScript, which reads templates/main.example.ts: in the
  // single-file executable that template only exists because this call has
  // just written it. A no-op in a checkout (nothing is embedded, and existing
  // files are never overwritten).
  await materialiseEmbeddedFiles(ROOT, runtime.fs, runtime.path);
  await ensureMainScript();
  const [config, summary] = await Promise.all([loadConfig(), activeSummary()]);
  return { app: createApp(), config, summary };
}
