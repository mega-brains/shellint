import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
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

const DIR = join(ROOT, ".devroom");
const FILE = join(DIR, "build-history.jsonl");
const MAX_ROWS = 200;

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
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

export function appendBuildHistory(
  sizes: BuildSizes,
  stats?: ScriptStats | null,
  memEstimate?: number,
): BuildHistoryRow {
  ensureDir();
  const row: BuildHistoryRow = {
    ts: new Date().toISOString(),
    sizes,
    stats: summarizeStats(stats),
    memEstimate,
  };
  appendFileSync(FILE, `${JSON.stringify(row)}\n`, "utf8");
  trimHistory();
  return row;
}

function trimHistory() {
  if (!existsSync(FILE)) return;
  const lines = readFileSync(FILE, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length <= MAX_ROWS) return;
  const kept = lines.slice(lines.length - MAX_ROWS);
  writeFileSync(FILE, `${kept.join("\n")}\n`, "utf8");
}

export function readBuildHistory(limit = 30): BuildHistoryRow[] {
  if (!existsSync(FILE)) return [];
  const lines = readFileSync(FILE, "utf8")
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
