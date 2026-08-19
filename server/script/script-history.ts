import runtime from "#shellint/runtime";
import { STATE_DIR } from "../core/paths.ts";

export type ScriptHistoryRow = {
  id: string;
  source: string;
  bytes: number;
};

const DIR = STATE_DIR;
const FILE = runtime.path.join(DIR, "script-history.jsonl");
const MAX_ROWS = 10;
/** Autosave snapshots within this long of the last row are coalesced away. */
export const COALESCE_WINDOW_MS = 60_000;
let writes: Promise<void> = Promise.resolve();

async function ensureDir() {
  await runtime.fs.mkdir(DIR, { recursive: true });
}

async function readAllRows(): Promise<ScriptHistoryRow[]> {
  if (!(await runtime.fs.exists(FILE))) return [];
  const lines = (await runtime.fs.readText(FILE))
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

async function writeAllRows(rows: ScriptHistoryRow[]) {
  await runtime.fs.atomicWriteText(
    FILE,
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
  );
}

async function appendRow(
  rows: ScriptHistoryRow[],
  source: string,
  now: number,
): Promise<ScriptHistoryRow> {
  await ensureDir();
  const row: ScriptHistoryRow = {
    id: new Date(now).toISOString(),
    source,
    bytes: runtime.byteLength(source),
  };
  const trimmed = [...rows, row].slice(-MAX_ROWS);
  await writeAllRows(trimmed);
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
export async function snapshotBeforeWrite(
  currentSource: string,
  newSource: string,
  now: number = Date.now(),
): Promise<void> {
  if (currentSource === newSource) return;
  const operation = writes.then(async () => {
    const rows = await readAllRows();
    const last = rows[rows.length - 1];
    if (last && last.source === currentSource) return;
    if (last && now - new Date(last.id).getTime() < COALESCE_WINDOW_MS) return;
    await appendRow(rows, currentSource, now);
  });
  writes = operation.catch(() => undefined);
  await operation;
}

/**
 * Explicit "checkpoint now" — unlike `snapshotBeforeWrite`, bypasses the
 * coalescing window since it's a deliberate user action, not an autosave
 * tick. Still dedupes against an identical most-recent row. Returns the
 * created row, or null if deduped.
 */
export async function checkpointNow(
  currentSource: string,
  now: number = Date.now(),
): Promise<ScriptHistoryRow | null> {
  let created: ScriptHistoryRow | null = null;
  const operation = writes.then(async () => {
    const rows = await readAllRows();
    const last = rows[rows.length - 1];
    if (last && last.source === currentSource) return;
    created = await appendRow(rows, currentSource, now);
  });
  writes = operation.catch(() => undefined);
  await operation;
  return created;
}

export async function listScriptHistory(): Promise<{ id: string; bytes: number; ts: string }[]> {
  await writes;
  return (await readAllRows())
    .map((r) => ({ id: r.id, bytes: r.bytes, ts: r.id }))
    .reverse();
}

export async function readScriptHistoryRow(id: string): Promise<ScriptHistoryRow | null> {
  await writes;
  return (await readAllRows()).find((r) => r.id === id) ?? null;
}
