import { prepareStartup } from "./startup.ts";

const { app, config: cfg, summary } = await prepareStartup();
const server = tjs.serve({
  fetch: app.fetch,
  listenIp: cfg.host,
  port: cfg.port,
});

const host = cfg.host === "0.0.0.0" ? "127.0.0.1" : cfg.host;
console.log(`Shelly DevRoom listening on http://${host}:${server.port}`);
console.log(
  `  bind ${cfg.host}:${server.port} · ${summary} · compiler ${cfg.compiler} · runtime txiki.js`,
);
