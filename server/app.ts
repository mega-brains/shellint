import { Hono } from "hono";
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { WEB_DIR, ROOT } from "./paths.ts";
import { registerDeviceRoutes } from "./routes-device.ts";
import { registerProbeRoutes } from "./routes-probe.ts";
import { registerScriptBuildRoutes } from "./routes-script.ts";
import { apiDocsJson, appJs, appJsMap, css } from "./static-assets.ts";

export function createApp() {
  const app = new Hono();

  registerScriptBuildRoutes(app);
  registerDeviceRoutes(app);
  registerProbeRoutes(app);

  app.get("/", (c) => {
    const index = join(WEB_DIR, "index.html");
    if (!existsSync(index)) {
      return c.text("web/index.html missing", 500);
    }
    return c.html(readFileSync(index, "utf8"));
  });

  app.get("/:name{[a-z0-9-]+\\.css}", (c) => css(c, c.req.param("name")));

  app.get("/api-docs.json", apiDocsJson);

  app.get("/app.js", appJs);

  app.get("/app.js.map", appJsMap);

  // Sourcemap and any other web/dist assets
  const webRoot = relative(process.cwd(), ROOT) || ".";
  app.use(
    "/web/*",
    serveStatic({
      root: webRoot,
    }),
  );

  return app;
}
