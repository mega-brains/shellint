import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ROOT } from "../core/paths.ts";

export type ScriptHistoryRow = {
  id: string;
  source: string;
  bytes: number;
};

const DIR = join(ROOT, ".devroom");
const FILE = join(DIR, "script-history.jsonl");
const MAX_ROWS = 10;
/** Autosave snapshots within this long of the last row are coalesced away. */
export const COALESCE_WINDOW_MS = 60_000;

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

function readAllRows(): ScriptHistoryRow[] {
  if (!existsSync(FILE)) return [];
  const lines = readFileSync(FILE, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const rows: ScriptHistoryRow[] = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line) as ScriptHistoryRow);
    } catch {
      /* skip corrupt */
    }
  }
  return rows;
}

function writeAllRows(rows: ScriptHistoryRow[]) {
  writeFileSync(
    FILE,
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
}

function appendRow(
  rows: ScriptHistoryRow[],
  source: string,
  now: number,
): ScriptHistoryRow {
  ensureDir();
  const row: ScriptHistoryRow = {
    id: new Date(now).toISOString(),
    source,
    bytes: Buffer.byteLength(source, "utf8"),
  };
  const trimmed = [...rows, row].slice(-MAX_ROWS);
  writeAllRows(trimmed);
  return row;
}

/**
 * Snapshots the content currently on disk before it gets overwritten by
 * `newSource`, so a save/restore never destroys the version it replaces.
 * Skipped when: the current content is unchanged from `newSource` (no-op
 * save); it matches the most recent history row (repeated autosave on
 * unchanged text); or the most recent row is younger than
 * `COALESCE_WINDOW_MS` (an editing burst under autosave's debounce
 * shouldn't consume most of the 10 slots). `now` is injectable for tests.
 */
export function snapshotBeforeWrite(
  currentSource: string,
  newSource: string,
  now: number = Date.now(),
): void {
  if (currentSource === newSource) return;
  const rows = readAllRows();
  const last = rows[rows.length - 1];
  if (last && last.source === currentSource) return;
  if (last && now - new Date(last.id).getTime() < COALESCE_WINDOW_MS) return;
  appendRow(rows, currentSource, now);
}

/**
 * Explicit "checkpoint now" — unlike `snapshotBeforeWrite`, bypasses the
 * coalescing window since it's a deliberate user action, not an autosave
 * tick. Still dedupes against an identical most-recent row. Returns the
 * created row, or null if deduped.
 */
export function checkpointNow(
  currentSource: string,
  now: number = Date.now(),
): ScriptHistoryRow | null {
  const rows = readAllRows();
  const last = rows[rows.length - 1];
  if (last && last.source === currentSource) return null;
  return appendRow(rows, currentSource, now);
}

export function listScriptHistory(): { id: string; bytes: number; ts: string }[] {
  return readAllRows()
    .map((r) => ({ id: r.id, bytes: r.bytes, ts: r.id }))
    .reverse();
}

export function readScriptHistoryRow(id: string): ScriptHistoryRow | null {
  return readAllRows().find((r) => r.id === id) ?? null;
}
