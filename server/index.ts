import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const cfg = loadConfig();
const app = createApp();

serve(
  {
    fetch: app.fetch,
    hostname: cfg.host,
    port: cfg.port,
  },
  (info) => {
    const host = cfg.host === "0.0.0.0" ? "127.0.0.1" : cfg.host;
    console.log(`Shelly DevRoom listening on http://${host}:${info.port}`);
    console.log(`  bind ${cfg.host}:${cfg.port} · device ${cfg.deviceIp} · scriptId ${cfg.scriptId} · compiler ${cfg.compiler}`);
  },
);
