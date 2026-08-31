import { prepareStartup } from "./startup.ts";

function openBrowser(url: string) {
  const system = navigator.platform.toLowerCase();
  const command = system.includes("win")
    ? ["cmd.exe", "/c", "start", "", url]
    : system.includes("mac")
      ? ["open", url]
      : system.includes("linux")
        ? ["xdg-open", url]
        : undefined;
  if (!command) {
    console.warn(`Could not open browser on ${system}`);
    return;
  }
  try {
    tjs.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  } catch (error) {
    console.warn(`Could not open browser: ${String(error)}`);
  }
}

const { app, config: cfg, summary } = await prepareStartup();
const server = tjs.serve({
  fetch: app.fetch,
  listenIp: cfg.host,
  port: cfg.port,
});

const host = cfg.host === "0.0.0.0" ? "127.0.0.1" : cfg.host;
console.log(`shellint listening on http://${host}:${server.port}`);
console.log(
  `  bind ${cfg.host}:${server.port} · ${summary} · compiler ${cfg.compiler} · runtime txiki.js`,
);
openBrowser(`http://${host}:${server.port}`);
