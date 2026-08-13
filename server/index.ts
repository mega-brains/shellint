import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./core/config.ts";
import { requireActive } from "./device/devices.ts";

const cfg = loadConfig();
const app = createApp();

function activeSummary(): string {
  try {
    const target = requireActive();
    return `device ${target.device.label} (${target.device.ip}) · slot ${target.slot}`;
  } catch {
    return "no device selected — add one from the UI";
  }
}

serve(
  {
    fetch: app.fetch,
    hostname: cfg.host,
    port: cfg.port,
  },
  (info) => {
    const host = cfg.host === "0.0.0.0" ? "127.0.0.1" : cfg.host;
    console.log(`Shelly DevRoom listening on http://${host}:${info.port}`);
    console.log(`  bind ${cfg.host}:${cfg.port} · ${activeSummary()} · compiler ${cfg.compiler}`);
  },
);
