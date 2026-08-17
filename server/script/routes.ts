import type { Hono, Context } from "hono";
import {
  loadConfig,
  sanitizeConfig,
  patchMinifyConfig,
  CompilerNotWiredError,
  type MinifyConfig,
} from "../core/config.ts";
import { runBuild } from "./build.ts";
import { analyzeScriptFile, analyzeVariants } from "./script-stats.ts";
import { appendBuildHistory, readBuildHistory } from "./build-history.ts";
import { checkBuildArtifacts } from "../lint/dialect-check.ts";
import { runCheck, type CheckProgress, type CheckReport } from "../lint/check.ts";
import { CHECK_CATALOG, CHECK_GROUPS } from "../lint/check-catalog.ts";
import { estimateMemoryFile } from "./memory-estimate.ts";
import { minFirmware } from "./min-firmware.ts";
import { listArtifacts, readArtifact } from "./artifacts.ts";
import { registerScriptRoutes } from "./routes-source.ts";
import { listDevices, loadDevices, sanitizeDevice } from "../device/devices.ts";
import { MINIFY_KEYS } from "../../shared/minify-options.mjs";

type CheckStreamEvent =
  | { type: "progress"; done: number; total: number }
  | { type: "report"; report: CheckReport }
  | { type: "error"; error: string };

async function checkConnected(c: Context): Promise<boolean> {
  let connected = c.req.query("connected") === "1";
  if (c.req.method !== "POST") return connected;
  try {
    const body = (await c.req.json()) as { connected?: unknown };
    connected = body.connected === true;
  } catch {
    /* body is optional */
  }
  return connected;
}

function checkError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Config, build, check, stats, history, artifacts — plus script source CRUD (script-routes.ts). Split out of app.ts to stay under the 500-line cap. */
export function registerScriptBuildRoutes(app: Hono) {
  app.get("/api/config", async (c) => {
    const devicesFile = await loadDevices();
    const devices = await listDevices();
    return c.json({
      ok: true,
      config: sanitizeConfig(await loadConfig()),
      devices: await Promise.all(devices.map(sanitizeDevice)),
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
    const cfg = await patchMinifyConfig(patch);
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
        stats = await analyzeScriptFile();
        variants = await analyzeVariants(stats);
      } catch {
        /* stats are best-effort */
      }
      const estimate = await estimateMemoryFile();
      const historyRow = await appendBuildHistory(sizes, stats, estimate.bytes);
      const dialect = await checkBuildArtifacts();
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
    const connected = await checkConnected(c);
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

  app.post("/api/check/stream", async (c) => {
    const connected = await checkConnected(c);
    const encoder = new TextEncoder();
    // A browser that navigates away mid-check leaves the stream closed under
    // us, and `enqueue` on a closed controller throws from inside a `.then`,
    // i.e. as an unhandled rejection that takes the whole server down. The
    // check itself keeps running to completion; its events are just dropped.
    let open = true;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: CheckStreamEvent) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            open = false;
          }
        };
        const close = () => {
          if (!open) return;
          open = false;
          controller.close();
        };
        const onProgress = ({ done, total }: CheckProgress) => {
          send({ type: "progress", done, total });
        };
        void runCheck({ connected, onProgress }).then(
          (report) => {
            send({ type: "report", report });
            close();
          },
          (e) => {
            send({ type: "error", error: checkError(e) });
            close();
          },
        );
      },
      cancel() {
        open = false;
      },
    });
    return c.body(stream, 200, {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    });
  });

  // The catalog alone, so the UI can list every check before the first run.
  app.get("/api/checks", (c) => {
    return c.json({ ok: true, groups: CHECK_GROUPS, checks: CHECK_CATALOG });
  });

  app.get("/api/stats", async (c) => {
    try {
      const stats = await analyzeScriptFile();
      return c.json({
        ok: true,
        stats,
        variants: await analyzeVariants(stats),
        estimate: await estimateMemoryFile(),
        minFirmware: minFirmware(stats.apis),
      });
    } catch (e) {
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        500,
      );
    }
  });

  app.get("/api/history", async (c) => {
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : 20;
    const history = await readBuildHistory(
      Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : 20,
    );
    return c.json({ ok: true, history });
  });

  app.get("/api/artifacts", async (c) => {
    return c.json({ ok: true, artifacts: await listArtifacts() });
  });

  app.get("/api/artifact", async (c) => {
    const artifact = await readArtifact(c.req.query("name") ?? "");
    if (!artifact) {
      return c.json({ ok: false, error: "unknown or unbuilt artifact" }, 404);
    }
    return c.json({ ok: true, ...artifact });
  });
}
