import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ROOT } from "./paths.ts";

export type ScriptHistoryRow = {
  id: string;
  source: string;
  bytes: number;
};

const DIR = join(ROOT, ".devroom");
const FILE = join(DIR, "script-history.jsonl");
const MAX_ROWS = 10;

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

/**
 * Snapshots the content currently on disk before it gets overwritten by
 * `newSource`, so a save/restore never destroys the version it replaces.
 * Skipped when the current content is unchanged from `newSource` (no-op
 * save) or matches the most recent history row (repeated autosave on
 * unchanged text) — a real edit always produces exactly one row.
 */
export function snapshotBeforeWrite(
  currentSource: string,
  newSource: string,
): void {
  if (currentSource === newSource) return;
  ensureDir();
  const rows = readAllRows();
  const last = rows[rows.length - 1];
  if (last && last.source === currentSource) return;
  rows.push({
    id: new Date().toISOString(),
    source: currentSource,
    bytes: Buffer.byteLength(currentSource, "utf8"),
  });
  const trimmed = rows.length > MAX_ROWS ? rows.slice(rows.length - MAX_ROWS) : rows;
  writeAllRows(trimmed);
}

export function listScriptHistory(): { id: string; bytes: number; ts: string }[] {
  return readAllRows()
    .map((r) => ({ id: r.id, bytes: r.bytes, ts: r.id }))
    .reverse();
}

export function readScriptHistoryRow(id: string): ScriptHistoryRow | null {
  return readAllRows().find((r) => r.id === id) ?? null;
}
