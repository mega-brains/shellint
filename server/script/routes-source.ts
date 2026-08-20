import type { Router } from "../core/router.ts";
import runtime from "#shellint/runtime";
import { SCRIPT_LABEL, SCRIPT_PATH } from "../core/paths.ts";
import {
  snapshotBeforeWrite,
  checkpointNow,
  listScriptHistory,
  readScriptHistoryRow,
} from "./script-history.ts";

/** `/api/script` (read/write) plus history/checkpoint/restore. Split out of app.ts to stay under the 500-line cap. */
export function registerScriptRoutes(app: Router) {
  app.get("/api/script", async (c) => {
    if (!(await runtime.fs.exists(SCRIPT_PATH))) {
      return c.json({ ok: false, error: `${SCRIPT_LABEL} not found` }, 404);
    }
    const source = await runtime.fs.readText(SCRIPT_PATH);
    return c.json({ ok: true, path: SCRIPT_LABEL, source });
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
    if (await runtime.fs.exists(SCRIPT_PATH)) {
      await snapshotBeforeWrite(await runtime.fs.readText(SCRIPT_PATH), body.source);
    }
    await runtime.fs.atomicWriteText(SCRIPT_PATH, body.source);
    return c.json({ ok: true, bytes: runtime.byteLength(body.source) });
  });

  app.get("/api/script/history", async (c) => {
    return c.json({ ok: true, rows: await listScriptHistory() });
  });

  app.post("/api/script/checkpoint", async (c) => {
    if (!(await runtime.fs.exists(SCRIPT_PATH))) {
      return c.json({ ok: false, error: `${SCRIPT_LABEL} not found` }, 404);
    }
    const source = await runtime.fs.readText(SCRIPT_PATH);
    const row = await checkpointNow(source);
    return c.json({ ok: true, created: row !== null, id: row?.id ?? null });
  });

  app.get("/api/script/history/:id", async (c) => {
    const row = await readScriptHistoryRow(c.req.param("id"));
    if (!row) {
      return c.json({ ok: false, error: "unknown history id" }, 404);
    }
    return c.json({ ok: true, id: row.id, source: row.source });
  });

  app.post("/api/script/restore", async (c) => {
    let body: { id?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "expected JSON body { id }" }, 400);
    }
    if (typeof body.id !== "string") {
      return c.json({ ok: false, error: "body.id must be a string" }, 400);
    }
    const row = await readScriptHistoryRow(body.id);
    if (!row) {
      return c.json({ ok: false, error: "unknown history id" }, 404);
    }
    if (await runtime.fs.exists(SCRIPT_PATH)) {
      await snapshotBeforeWrite(await runtime.fs.readText(SCRIPT_PATH), row.source);
    }
    await runtime.fs.atomicWriteText(SCRIPT_PATH, row.source);
    return c.json({ ok: true, bytes: runtime.byteLength(row.source) });
  });
}
