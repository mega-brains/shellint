import type { Hono, Context } from "hono";
import {
  loadConfig,
  sanitizeConfig,
  patchMinifyConfig,
  CompilerNotWiredError,
  type MinifyConfig,
} from "./config.ts";
import { runBuild } from "./build.ts";
import { analyzeScriptFile, analyzeVariants } from "./script-stats.ts";
import { appendBuildHistory, readBuildHistory } from "./build-history.ts";
import { checkBuildArtifacts } from "./dialect-check.ts";
import { runCheck } from "./check.ts";
import { CHECK_CATALOG, CHECK_GROUPS } from "./check-catalog.ts";
import { estimateMemoryFile } from "./memory-estimate.ts";
import { minFirmware } from "./min-firmware.ts";
import { listArtifacts, readArtifact } from "./artifacts.ts";
import { registerScriptRoutes } from "./script-routes.ts";
import { listDevices, loadDevices, sanitizeDevice } from "./devices.ts";
import { MINIFY_KEYS } from "../shared/minify-options.mjs";

/** Config, build, check, stats, history, artifacts — plus script source CRUD (script-routes.ts). Split out of app.ts to stay under the 500-line cap. */
export function registerScriptBuildRoutes(app: Hono) {
  app.get("/api/config", (c) => {
    const devicesFile = loadDevices();
    return c.json({
      ok: true,
      config: sanitizeConfig(loadConfig()),
      devices: listDevices().map(sanitizeDevice),
      active: devicesFile.active,
    });
  });

  app.patch("/api/config", async (c) => {
    let body: { minify?: Partial<MinifyConfig> };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { ok: false, error: 'expected JSON body { minify: { … } }' },
        400,
      );
    }
    if (!body.minify || typeof body.minify !== "object" || Array.isArray(body.minify)) {
      return c.json(
        { ok: false, error: "body.minify must be an object of boolean knobs" },
        400,
      );
    }
    // Driven off the shared schema, never a hand-listed subset: a key added to
    // shared/minify-options.mjs and rendered by the options panel would
    // otherwise 400 here and silently never persist.
    const patch: Partial<MinifyConfig> = {};
    for (const key of MINIFY_KEYS) {
      if (key in body.minify) {
        if (typeof body.minify[key] !== "boolean") {
          return c.json(
            { ok: false, error: `minify.${key} must be a boolean` },
            400,
          );
        }
        patch[key] = body.minify[key];
      }
    }
    if (Object.keys(patch).length === 0) {
      return c.json(
        { ok: false, error: "body.minify must include at least one known key" },
        400,
      );
    }
    const cfg = patchMinifyConfig(patch);
    return c.json({ ok: true, config: sanitizeConfig(cfg) });
  });

  registerScriptRoutes(app);

  app.post("/api/build", async (c) => {
    try {
      let skipTypeCheck = false;
      try {
        const body = (await c.req.json()) as { skipTypeCheck?: unknown };
        skipTypeCheck = body.skipTypeCheck === true;
      } catch {
        /* body is optional */
      }
      const { sizes, stdout, stderr } = await runBuild({ skipTypeCheck });
      let stats = null;
      let variants = null;
      try {
        stats = analyzeScriptFile();
        variants = analyzeVariants(stats);
      } catch {
        /* stats are best-effort */
      }
      const estimate = estimateMemoryFile();
      const historyRow = appendBuildHistory(sizes, stats, estimate.bytes);
      const dialect = checkBuildArtifacts();
      return c.json({
        ok: true,
        sizes,
        stats,
        variants,
        estimate,
        minFirmware: stats ? minFirmware(stats.apis) : null,
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

  // `ok` stays transport-level; compliance verdict lives in report.ok
  const check = async (c: Context) => {
    let connected = c.req.query("connected") === "1";
    if (c.req.method === "POST") {
      try {
        const body = (await c.req.json()) as { connected?: unknown };
        connected = body.connected === true;
      } catch {
        /* body is optional */
      }
    }
    try {
      return c.json({ ok: true, report: await runCheck({ connected }) });
    } catch (e) {
      if (e instanceof CompilerNotWiredError) {
        return c.json({ ok: false, error: e.message }, 400);
      }
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        500,
      );
    }
  };

  app.post("/api/check", check);
  app.get("/api/check", check);

  // The catalog alone, so the UI can list every check before the first run.
  app.get("/api/checks", (c) => {
    return c.json({ ok: true, groups: CHECK_GROUPS, checks: CHECK_CATALOG });
  });

  app.get("/api/stats", (c) => {
    try {
      const stats = analyzeScriptFile();
      return c.json({
        ok: true,
        stats,
        variants: analyzeVariants(stats),
        estimate: estimateMemoryFile(),
        minFirmware: minFirmware(stats.apis),
      });
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

  app.get("/api/artifacts", (c) => {
    return c.json({ ok: true, artifacts: listArtifacts() });
  });

  app.get("/api/artifact", (c) => {
    const artifact = readArtifact(c.req.query("name") ?? "");
    if (!artifact) {
      return c.json({ ok: false, error: "unknown or unbuilt artifact" }, 404);
    }
    return c.json({ ok: true, ...artifact });
  });
}
