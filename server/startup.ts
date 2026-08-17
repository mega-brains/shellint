import { createApp } from "./app.ts";
import { loadConfig } from "./core/config.ts";
import { requireActive } from "./device/devices.ts";

async function activeSummary(): Promise<string> {
  try {
    const target = await requireActive();
    return `device ${target.device.label} (${target.device.ip}) · slot ${target.slot}`;
  } catch {
    return "no device selected — add one from UI";
  }
}

export async function prepareStartup() {
  const [config, summary] = await Promise.all([loadConfig(), activeSummary()]);
  return { app: createApp(), config, summary };
}
