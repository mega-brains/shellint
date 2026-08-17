import { Hono } from "hono";
import { runtime } from "#devroom/runtime";
import { WEB_DIR } from "./core/paths.ts";
import { registerDeviceRoutes } from "./device/routes.ts";
import { registerProbeRoutes } from "./probe/routes.ts";
import { registerScriptBuildRoutes } from "./script/routes.ts";
import { apiDocsJson, appJs, appJsMap, css, webAsset } from "./core/static-assets.ts";

export function createApp() {
  const app = new Hono();

  registerScriptBuildRoutes(app);
  registerDeviceRoutes(app);
  registerProbeRoutes(app);

  app.get("/", async (c) => {
    const index = runtime.path.join(WEB_DIR, "index.html");
    if (!(await runtime.fs.exists(index))) {
      return c.text("web/index.html missing", 500);
    }
    return c.html(await runtime.fs.readText(index));
  });

  app.get("/:name{[a-z0-9-]+\\.css}", (c) => css(c, c.req.param("name")));

  app.get("/api-docs.json", apiDocsJson);

  app.get("/app.js", appJs);

  app.get("/app.js.map", appJsMap);

  app.get("/web/*", webAsset);

  return app;
}
