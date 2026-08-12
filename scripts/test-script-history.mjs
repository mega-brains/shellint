/**
 * Snapshot-on-save, no-op dedupe, 10-row FIFO cap, restore round-trip (unit
 * + HTTP), 404 on unknown id. Touches the real scripts/main.ts and
 * .devroom/script-history.jsonl, so both are backed up and restored.
 * Usage: node --import tsx scripts/test-script-history.mjs
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  snapshotBeforeWrite,
  listScriptHistory,
  readScriptHistoryRow,
} from "../server/script-history.ts";
import { SCRIPT_PATH, ROOT } from "../server/paths.ts";
import { createApp } from "../server/app.ts";

const HISTORY_FILE = join(ROOT, ".devroom", "script-history.jsonl");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const originalScript = existsSync(SCRIPT_PATH)
  ? readFileSync(SCRIPT_PATH, "utf8")
  : null;
const originalHistory = existsSync(HISTORY_FILE)
  ? readFileSync(HISTORY_FILE, "utf8")
  : null;

function restore() {
  if (originalScript !== null) writeFileSync(SCRIPT_PATH, originalScript, "utf8");
  if (originalHistory !== null) writeFileSync(HISTORY_FILE, originalHistory, "utf8");
  else rmSync(HISTORY_FILE, { force: true });
}

try {
  rmSync(HISTORY_FILE, { force: true });

  // Real edit -> one row.
  snapshotBeforeWrite("var a = 1;", "var a = 2;");
  let rows = listScriptHistory();
  if (rows.length !== 1) fail(`expected 1 row after a real edit, got ${rows.length}`);

  // No-op save (current === new) -> no row.
  snapshotBeforeWrite("var a = 2;", "var a = 2;");
  if (listScriptHistory().length !== 1) fail("no-op save should not add a row");

  // Repeated autosave on unchanged text (current matches most recent row's
  // source) -> no duplicate row.
  snapshotBeforeWrite("var a = 1;", "var a = 3;");
  if (listScriptHistory().length !== 1) {
    fail("snapshot matching the most recent history row should dedupe");
  }

  // A genuinely new edit adds a second row.
  snapshotBeforeWrite("var a = 3;", "var a = 4;");
  rows = listScriptHistory();
  if (rows.length !== 2) fail(`expected 2 rows after a second real edit, got ${rows.length}`);
  if (rows[0].id <= rows[1].id) fail("listScriptHistory should return newest first");

  // 10-row FIFO cap.
  rmSync(HISTORY_FILE, { force: true });
  for (let i = 0; i < 12; i++) {
    snapshotBeforeWrite(`var a = ${i};`, `var a = ${i + 1};`);
  }
  rows = listScriptHistory();
  if (rows.length !== 10) fail(`expected cap at 10 rows, got ${rows.length}`);
  const oldestKept = readScriptHistoryRow(rows[rows.length - 1].id);
  if (oldestKept?.source !== "var a = 2;") {
    fail(`expected oldest surviving row to be "var a = 2;", got ${JSON.stringify(oldestKept?.source)}`);
  }

  // Unknown id.
  if (readScriptHistoryRow("not-a-real-id") !== null) {
    fail("readScriptHistoryRow should return null for an unknown id");
  }

  // HTTP round trip.
  rmSync(HISTORY_FILE, { force: true });
  writeFileSync(SCRIPT_PATH, "var live = 1;", "utf8");
  const app = createApp();

  const put = await app.request("/api/script", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "var live = 2;" }),
  });
  if (put.status !== 200) fail("PUT /api/script failed");

  const listed = await (await app.request("/api/script/history")).json();
  if (!listed.ok || listed.rows.length !== 1) {
    fail(`expected 1 history row after PUT, got ${JSON.stringify(listed)}`);
  }
  const id = listed.rows[0].id;

  const got = await (await app.request(`/api/script/history/${id}`)).json();
  if (!got.ok || got.source !== "var live = 1;") {
    fail(`expected history row source to be the pre-write content, got ${JSON.stringify(got)}`);
  }

  const missing = await app.request("/api/script/history/not-a-real-id");
  if (missing.status !== 404) fail("history/:id should 404 on unknown id");

  const restoreRes = await (
    await app.request("/api/script/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
  ).json();
  if (!restoreRes.ok) fail(`restore failed: ${JSON.stringify(restoreRes)}`);
  if (readFileSync(SCRIPT_PATH, "utf8") !== "var live = 1;") {
    fail("restore should write the picked row's source to disk");
  }

  const afterRestore = await (await app.request("/api/script/history")).json();
  if (afterRestore.rows.length !== 2) {
    fail("restore should itself snapshot the content it overwrites");
  }

  const badRestore = await app.request("/api/script/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "not-a-real-id" }),
  });
  if (badRestore.status !== 404) fail("restore of unknown id should 404");

  console.log("OK: script history snapshot/dedupe/cap/restore");
} finally {
  restore();
}
