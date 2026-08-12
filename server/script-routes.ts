import type { Hono } from "hono";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { SCRIPT_PATH } from "./paths.ts";
import {
  snapshotBeforeWrite,
  checkpointNow,
  listScriptHistory,
  readScriptHistoryRow,
} from "./script-history.ts";

/** `/api/script` (read/write) plus history/checkpoint/restore. Split out of app.ts to stay under the 500-line cap. */
export function registerScriptRoutes(app: Hono) {
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
    if (existsSync(SCRIPT_PATH)) {
      snapshotBeforeWrite(readFileSync(SCRIPT_PATH, "utf8"), body.source);
    }
    writeFileSync(SCRIPT_PATH, body.source, "utf8");
    return c.json({ ok: true, bytes: Buffer.byteLength(body.source, "utf8") });
  });

  app.get("/api/script/history", (c) => {
    return c.json({ ok: true, rows: listScriptHistory() });
  });

  app.post("/api/script/checkpoint", (c) => {
    if (!existsSync(SCRIPT_PATH)) {
      return c.json({ ok: false, error: "scripts/main.ts not found" }, 404);
    }
    const source = readFileSync(SCRIPT_PATH, "utf8");
    const row = checkpointNow(source);
    return c.json({ ok: true, created: row !== null, id: row?.id ?? null });
  });

  app.get("/api/script/history/:id", (c) => {
    const row = readScriptHistoryRow(c.req.param("id"));
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
    const row = readScriptHistoryRow(body.id);
    if (!row) {
      return c.json({ ok: false, error: "unknown history id" }, 404);
    }
    if (existsSync(SCRIPT_PATH)) {
      snapshotBeforeWrite(readFileSync(SCRIPT_PATH, "utf8"), row.source);
    }
    writeFileSync(SCRIPT_PATH, row.source, "utf8");
    return c.json({ ok: true, bytes: Buffer.byteLength(row.source, "utf8") });
  });
}
