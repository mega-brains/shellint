import runtime from "#shellint/runtime";
import { ROOT } from "../core/paths.ts";
import type { BuildSizes } from "./build.ts";
import type { ScriptStats } from "./script-stats.ts";

export type BuildHistoryRow = {
  ts: string;
  sizes: BuildSizes;
  stats?: {
    apiKinds: number;
    apiCalls: number;
    vars: number;
    consoleLog: number;
    timers: number;
    anonNest: number;
  };
  /** Static estimate at build time, kept so it can be calibrated later. */
  memEstimate?: number;
};

const DIR = runtime.path.join(ROOT, ".shellint");
const FILE = runtime.path.join(DIR, "build-history.jsonl");
const MAX_ROWS = 200;
let writes: Promise<void> = Promise.resolve();

async function ensureDir() {
  await runtime.fs.mkdir(DIR, { recursive: true });
}

function summarizeStats(stats: ScriptStats | null | undefined) {
  if (!stats) return undefined;
  const apiCalls = Object.values(stats.apis).reduce((a, b) => a + b, 0);
  return {
    apiKinds: Object.keys(stats.apis).length,
    apiCalls,
    vars: stats.declarations.vars,
    consoleLog: stats.logging.consoleLog,
    timers: stats.registrations.timers,
    anonNest: stats.nesting.maxAnonymousDepth,
  };
}

export async function appendBuildHistory(
  sizes: BuildSizes,
  stats?: ScriptStats | null,
  memEstimate?: number,
): Promise<BuildHistoryRow> {
  const row: BuildHistoryRow = {
    ts: new Date().toISOString(),
    sizes,
    stats: summarizeStats(stats),
    memEstimate,
  };
  const operation = writes.then(async () => {
    await ensureDir();
    const existing = (await runtime.fs.exists(FILE))
      ? await runtime.fs.readText(FILE)
      : "";
    await runtime.fs.atomicWriteText(FILE, `${existing}${JSON.stringify(row)}\n`);
    await trimHistory();
  });
  writes = operation.catch(() => undefined);
  await operation;
  return row;
}

async function trimHistory() {
  if (!(await runtime.fs.exists(FILE))) return;
  const lines = (await runtime.fs.readText(FILE))
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length <= MAX_ROWS) return;
  const kept = lines.slice(lines.length - MAX_ROWS);
  await runtime.fs.atomicWriteText(FILE, `${kept.join("\n")}\n`);
}

export async function readBuildHistory(limit = 30): Promise<BuildHistoryRow[]> {
  await writes;
  if (!(await runtime.fs.exists(FILE))) return [];
  const lines = (await runtime.fs.readText(FILE))
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const rows: BuildHistoryRow[] = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line) as BuildHistoryRow);
    } catch {
      /* skip corrupt */
    }
  }
  return rows.slice(-Math.max(1, limit)).reverse();
}
