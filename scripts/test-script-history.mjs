/**
 * Snapshot-on-save, no-op dedupe, coalescing window, checkpoint, 10-row FIFO
 * cap, restore round-trip (unit + HTTP), 404 on unknown id. Touches the real
 * scripts/main.ts and .shellint/script-history.jsonl, so both are backed up
 * and restored.
 * Usage: node --import tsx scripts/test-script-history.mjs
 */
import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  snapshotBeforeWrite,
  checkpointNow,
  listScriptHistory,
  readScriptHistoryRow,
  COALESCE_WINDOW_MS,
} from "../server/script/script-history.ts";
import { SCRIPT_PATH, ROOT } from "../server/core/paths.ts";
import { createApp } from "../server/app.ts";

const HISTORY_FILE = join(ROOT, ".shellint", "script-history.jsonl");
// Spacing used between calls that should each land outside the coalescing
// window, so tests don't depend on real wall-clock time passing.
const STEP_MS = COALESCE_WINDOW_MS + 1000;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const originalScript = existsSync(SCRIPT_PATH)
  ? readFileSync(SCRIPT_PATH, "utf8")
  : null;
// mtime, not just content, so restoring doesn't leave scripts/main.ts newer
// than dist/ and falsely trip the artifacts-stale check downstream.
const originalScriptMtime = existsSync(SCRIPT_PATH)
  ? statSync(SCRIPT_PATH).mtime
  : null;
const originalHistory = existsSync(HISTORY_FILE)
  ? readFileSync(HISTORY_FILE, "utf8")
  : null;

function restore() {
  if (originalScript !== null) {
    writeFileSync(SCRIPT_PATH, originalScript, "utf8");
    if (originalScriptMtime) utimesSync(SCRIPT_PATH, originalScriptMtime, originalScriptMtime);
  }
  if (originalHistory !== null) writeFileSync(HISTORY_FILE, originalHistory, "utf8");
  else rmSync(HISTORY_FILE, { force: true });
}

try {
  rmSync(HISTORY_FILE, { force: true });
  let t = Date.now();

  // Real edit, outside the coalescing window -> one row.
  await snapshotBeforeWrite("var a = 1;", "var a = 2;", t);
  let rows = await listScriptHistory();
  if (rows.length !== 1) fail(`expected 1 row after a real edit, got ${rows.length}`);

  // No-op save (current === new) -> no row.
  await snapshotBeforeWrite("var a = 2;", "var a = 2;", (t += STEP_MS));
  if ((await listScriptHistory()).length !== 1) fail("no-op save should not add a row");

  // Repeated autosave on unchanged text (current matches most recent row's
  // source) -> no duplicate row.
  await snapshotBeforeWrite("var a = 1;", "var a = 3;", (t += STEP_MS));
  if ((await listScriptHistory()).length !== 1) {
    fail("snapshot matching the most recent history row should dedupe");
  }

  // A genuinely new edit, outside the window -> adds a second row.
  await snapshotBeforeWrite("var a = 3;", "var a = 4;", (t += STEP_MS));
  rows = await listScriptHistory();
  if (rows.length !== 2) fail(`expected 2 rows after a second real edit, got ${rows.length}`);
  if (rows[0].id <= rows[1].id) fail("listScriptHistory should return newest first");

  // Coalescing window: a real edit that arrives within COALESCE_WINDOW_MS of
  // the last row is suppressed, even though its content differs.
  rmSync(HISTORY_FILE, { force: true });
  t = Date.now();
  await snapshotBeforeWrite("var b = 1;", "var b = 2;", t);
  await snapshotBeforeWrite("var b = 2;", "var b = 3;", t + 1000);
  rows = await listScriptHistory();
  if (rows.length !== 1) {
    fail(`expected coalescing to suppress a snapshot within the window, got ${rows.length} rows`);
  }
  const coalesced = await readScriptHistoryRow(rows[0].id);
  if (coalesced?.source !== "var b = 1;") {
    fail(`expected the coalesced row to keep the earliest content, got ${JSON.stringify(coalesced?.source)}`);
  }

  // Once the window elapses, the next real edit adds a second row.
  await snapshotBeforeWrite("var b = 3;", "var b = 4;", t + STEP_MS);
  rows = await listScriptHistory();
  if (rows.length !== 2) fail(`expected a new row once the coalescing window elapsed, got ${rows.length}`);

  // checkpointNow bypasses the coalescing window (a deliberate user action).
  await checkpointNow("var b = 4;", t + STEP_MS + 500);
  rows = await listScriptHistory();
  if (rows.length !== 3) fail(`expected checkpointNow to add a row despite being inside the window, got ${rows.length}`);

  // checkpointNow still dedupes an identical repeat.
  const dupe = await checkpointNow("var b = 4;", t + STEP_MS + 900);
  if (dupe !== null) fail("checkpointNow should dedupe against an identical most-recent row");
  if ((await listScriptHistory()).length !== 3) fail("deduped checkpoint should not add a row");

  // 10-row FIFO cap, each snapshot spaced outside the coalescing window.
  rmSync(HISTORY_FILE, { force: true });
  t = Date.now();
  for (let i = 0; i < 12; i++) {
    await snapshotBeforeWrite(`var a = ${i};`, `var a = ${i + 1};`, t + i * STEP_MS);
  }
  rows = await listScriptHistory();
  if (rows.length !== 10) fail(`expected cap at 10 rows, got ${rows.length}`);
  const oldestKept = await readScriptHistoryRow(rows[rows.length - 1].id);
  if (oldestKept?.source !== "var a = 2;") {
    fail(`expected oldest surviving row to be "var a = 2;", got ${JSON.stringify(oldestKept?.source)}`);
  }

  // Unknown id.
  if ((await readScriptHistoryRow("not-a-real-id")) !== null) {
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

  // Restore happens moments after the PUT snapshot (same test, real clock),
  // so it lands inside the coalescing window relative to that row — the
  // restore route uses snapshotBeforeWrite, same as PUT, so this is expected
  // to be suppressed rather than adding a second row.
  const afterRestore = await (await app.request("/api/script/history")).json();
  if (afterRestore.rows.length !== 1) {
    fail(`expected restore's own snapshot to coalesce with the just-made PUT snapshot, got ${afterRestore.rows.length}`);
  }

  const badRestore = await app.request("/api/script/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "not-a-real-id" }),
  });
  if (badRestore.status !== 404) fail("restore of unknown id should 404");

  // POST /api/script/checkpoint: explicit checkpoint over HTTP.
  rmSync(HISTORY_FILE, { force: true });
  writeFileSync(SCRIPT_PATH, "var chk = 1;", "utf8");
  const cp1 = await (await app.request("/api/script/checkpoint", { method: "POST" })).json();
  if (!cp1.ok || !cp1.created) fail(`expected checkpoint to create a row, got ${JSON.stringify(cp1)}`);
  const afterCp1 = await (await app.request("/api/script/history")).json();
  if (afterCp1.rows.length !== 1) fail("checkpoint should add exactly one row");

  // A second checkpoint moments later, with unchanged file content, dedupes
  // even though it's called via the HTTP route (bypasses coalescing, but not
  // the identical-content dedupe).
  const cp2 = await (await app.request("/api/script/checkpoint", { method: "POST" })).json();
  if (!cp2.ok || cp2.created) fail("checkpoint of unchanged content should dedupe, not duplicate");

  console.log("OK: script history snapshot/coalesce/checkpoint/cap/restore");
} finally {
  restore();
}
