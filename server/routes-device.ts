import type { Hono } from "hono";
import { CompilerNotWiredError } from "./config.ts";
import { deploy, AuthNotSupportedError } from "./deploy.ts";
import { runProbe, getProbeProgress } from "./probe.ts";
import {
  fetchDeviceStatus,
  rebootDevice,
  setEcoMode,
  setScriptRunning,
} from "./device-status.ts";
import { readLogs, startLogStream, stopLogStream } from "./debug-log.ts";
import { expandLogText, loadLogMap } from "./log-map.ts";
import { writeGeneratedTypings } from "./probe-typings.ts";

/** Device telemetry, logs, probe, deploy. Split out of app.ts to stay under the 500-line cap. */
export function registerDeviceRoutes(app: Hono) {
  app.get("/api/device/logs", (c) => {
    const sinceRaw = Number(c.req.query("since"));
    const since = Number.isFinite(sinceRaw) ? Math.max(0, sinceRaw) : 0;
    const stream = readLogs(since);
    // Prod builds ship shortened log strings; the viewer is the other half of
    // that trade, so ids become readable again here rather than on the device.
    const map = loadLogMap();
    const lines = stream.lines.map((l) => ({
      ...l,
      text: expandLogText(l.text, map),
    }));
    return c.json({ ok: true, stream: { ...stream, lines } });
  });

  app.post("/api/device/logs", async (c) => {
    let action = "start";
    try {
      const body = (await c.req.json()) as { action?: unknown };
      if (body.action === "stop") action = "stop";
    } catch {
      /* default to start */
    }
    if (action === "stop") {
      stopLogStream();
      return c.json({ ok: true, connected: false });
    }
    try {
      return c.json({ ok: true, ...(await startLogStream()) });
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

  app.get("/api/probe/progress", (c) => {
    return c.json({ ok: true, ...getProbeProgress() });
  });

  app.post("/api/probe", async (c) => {
    try {
      const report = await runProbe();
      // Same as `mise run probe`: fresh answers, freshly generated typings.
      const typings = writeGeneratedTypings();
      return c.json({ ok: true, report, typings });
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

  app.post("/api/device/script", async (c) => {
    let body: { running?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { ok: false, error: "expected JSON body { running: boolean }" },
        400,
      );
    }
    if (typeof body.running !== "boolean") {
      return c.json({ ok: false, error: "running must be a boolean" }, 400);
    }
    try {
      return c.json({ ok: true, ...(await setScriptRunning(body.running)) });
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

  /** Soft reboot — `Shelly.Reboot`, not factory reset. */
  app.post("/api/device/reboot", async (c) => {
    try {
      await rebootDevice();
      return c.json({ ok: true });
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
}
