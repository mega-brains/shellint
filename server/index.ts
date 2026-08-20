import { serve } from "./core/node-server.ts";
import { prepareStartup } from "./startup.ts";

const { app, config: cfg, summary } = await prepareStartup();

serve(
  {
    fetch: app.fetch,
    hostname: cfg.host,
    port: cfg.port,
  },
  (info) => {
    const host = cfg.host === "0.0.0.0" ? "127.0.0.1" : cfg.host;
    console.log(`shellint listening on http://${host}:${info.port}`);
    console.log(`  bind ${cfg.host}:${cfg.port} · ${summary} · compiler ${cfg.compiler}`);
  },
);
