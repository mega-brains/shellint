import { Hono } from "hono";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  loadConfig,
  sanitizeConfig,
  CompilerNotWiredError,
} from "./config.ts";
import { SCRIPT_PATH, WEB_DIR, ROOT } from "./paths.ts";
import { runBuild } from "./build.ts";
import { deploy, AuthNotSupportedError } from "./deploy.ts";
import { runProbe } from "./probe.ts";
import { fetchDeviceStatus, setEcoMode } from "./device-status.ts";
import { analyzeScriptFile } from "./script-stats.ts";
import { appendBuildHistory, readBuildHistory } from "./build-history.ts";
import { checkBuildArtifacts } from "./dialect-check.ts";
import { runCheck } from "./check.ts";

export function createApp() {
  const app = new Hono();

  app.get("/api/config", (c) => {
    return c.json({ ok: true, config: sanitizeConfig(loadConfig()) });
  });

  app.get("/api/script", (c) => {
    if (!existsSync(SCRIPT_PATH)) {
      return c.json({ ok: false, error: "scripts/main.ts not found" }, 404);
    }
    const source = readFileSync(SCRIPT_PATH, "utf8");
    return c.json({ ok: true, path: "scripts/main.ts", source });
  });

  app.put("/api/script", async (c) => {
    let body: { source?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "expected JSON body { source }" }, 400);
    }
    if (typeof body.source !== "string") {
      return c.json({ ok: false, error: "body.source must be a string" }, 400);
    }
    writeFileSync(SCRIPT_PATH, body.source, "utf8");
    return c.json({ ok: true, bytes: Buffer.byteLength(body.source, "utf8") });
  });

  app.post("/api/build", async (c) => {
    try {
      const { sizes, stdout, stderr } = await runBuild();
      let stats = null;
      try {
        stats = analyzeScriptFile();
      } catch {
        /* stats are best-effort */
      }
      const historyRow = appendBuildHistory(sizes, stats);
      const dialect = checkBuildArtifacts();
      return c.json({
        ok: true,
        sizes,
        stats,
        historyRow,
        dialect,
        stdout,
        stderr,
      });
    } catch (e) {
      if (e instanceof CompilerNotWiredError) {
        return c.json({ ok: false, error: e.message }, 400);
      }
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        500,
      );
    }
  });

  const check = (c: Context) => {
    try {
      return c.json({ ok: true, ...runCheck() });
    } catch (e) {
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        500,
      );
    }
  };

  app.post("/api/check", check);
  app.get("/api/check", check);

  app.get("/api/stats", (c) => {
    try {
      const stats = analyzeScriptFile();
      return c.json({ ok: true, stats });
    } catch (e) {
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        500,
      );
    }
  });

  app.get("/api/history", (c) => {
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : 20;
    const history = readBuildHistory(
      Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : 20,
    );
    return c.json({ ok: true, history });
  });

  app.post("/api/deploy", async (c) => {
    let body: { mode?: string; minify?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          ok: false,
          error:
            'expected JSON body { mode: "debug"|"prod", minify?: "min"|"raw" }',
        },
        400,
      );
    }
    const mode = body.mode;
    if (mode !== "debug" && mode !== "prod") {
      return c.json({ ok: false, error: 'mode must be "debug" or "prod"' }, 400);
    }
    const minify = body.minify ?? "min";
    if (minify !== "min" && minify !== "raw") {
      return c.json(
        { ok: false, error: 'minify must be "min" or "raw"' },
        400,
      );
    }
    try {
      let lastStatus = "starting";
      const result = await deploy(
        mode,
        (msg) => {
          lastStatus = msg;
        },
        minify,
      );
      return c.json({
        ok: true,
        ...result,
        status: lastStatus === "running" ? "running" : lastStatus,
      });
    } catch (e) {
      if (e instanceof AuthNotSupportedError) {
        return c.json({ ok: false, error: "auth not supported yet" }, 401);
      }
      if (e instanceof CompilerNotWiredError) {
        return c.json({ ok: false, error: e.message }, 400);
      }
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        500,
      );
    }
  });

  app.post("/api/probe", async (c) => {
    try {
      const report = await runProbe();
      return c.json({ ok: true, report });
    } catch (e) {
      if (e instanceof AuthNotSupportedError) {
        return c.json({ ok: false, error: "auth not supported yet" }, 401);
      }
      if (e instanceof CompilerNotWiredError) {
        return c.json({ ok: false, error: e.message }, 400);
      }
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        500,
      );
    }
  });

  app.get("/api/device/status", async (c) => {
    try {
      const status = await fetchDeviceStatus();
      return c.json({ ok: true, status });
    } catch (e) {
      if (e instanceof AuthNotSupportedError) {
        return c.json({ ok: false, error: "auth not supported yet" }, 401);
      }
      if (e instanceof CompilerNotWiredError) {
        return c.json({ ok: false, error: e.message }, 400);
      }
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        500,
      );
    }
  });

  app.post("/api/device/eco", async (c) => {
    let body: { eco_mode?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { ok: false, error: "expected JSON body { eco_mode: boolean }" },
        400,
      );
    }
    if (typeof body.eco_mode !== "boolean") {
      return c.json({ ok: false, error: "eco_mode must be a boolean" }, 400);
    }
    try {
      const result = await setEcoMode(body.eco_mode);
      return c.json({ ok: true, ...result });
    } catch (e) {
      if (e instanceof AuthNotSupportedError) {
        return c.json({ ok: false, error: "auth not supported yet" }, 401);
      }
      if (e instanceof CompilerNotWiredError) {
        return c.json({ ok: false, error: e.message }, 400);
      }
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        500,
      );
    }
  });

  app.get("/", (c) => {
    const index = join(WEB_DIR, "index.html");
    if (!existsSync(index)) {
      return c.text("web/index.html missing", 500);
    }
    return c.html(readFileSync(index, "utf8"));
  });

  app.get("/styles.css", (c) => {
    const css = join(WEB_DIR, "styles.css");
    if (!existsSync(css)) return c.text("not found", 404);
    c.header("Content-Type", "text/css; charset=utf-8");
    return c.body(readFileSync(css, "utf8"));
  });

  app.get("/app.js", (c) => {
    const js = join(WEB_DIR, "dist", "app.js");
    if (!existsSync(js)) {
      return c.text(
        "console.error('web bundle missing — run: npm run build:web');",
        503,
      );
    }
    c.header("Content-Type", "application/javascript; charset=utf-8");
    return c.body(readFileSync(js));
  });

  app.get("/app.js.map", (c) => {
    const map = join(WEB_DIR, "dist", "app.js.map");
    if (!existsSync(map)) return c.text("not found", 404);
    c.header("Content-Type", "application/json");
    return c.body(readFileSync(map));
  });

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
