/**
 * The static build's replacement for web/lib/api.ts.
 *
 * Same signature as the real `api()`, matching on the same route strings the
 * Hono server serves, so the ~45 endpoint literals scattered across web/ keep
 * working untouched — swapping this one module is what makes a server-less
 * build possible without forking the UI (M17 plan §1). Response shapes must
 * match server/script/routes.ts exactly: a mismatch shows up as a blank panel
 * rather than an error, so they are mirrored field for field.
 *
 * Anything that needs a real Shelly on the LAN rejects as StaticModeError.
 * Those routes are unreachable in practice — device-section.tsx never mounts
 * the components that call them — so a rejection here means a regression, and
 * scripts/test-local-api.mjs asserts the route table stays exhaustive.
 */
import {
  DEFAULT_MINIFY,
  MINIFY_KEYS,
  type MinifyConfig,
} from "../../shared/minify-options.mjs";
import { CHECK_CATALOG, CHECK_GROUPS } from "../../server/lint/check-catalog.ts";
import type { ScriptStats } from "../../server/script/script-stats.ts";
import type { BuildResult, StatsResult } from "./pipeline-protocol";
import type { CheckProgress, CheckReport } from "../../server/lint/check.ts";
import { pipelineRequest } from "./worker-client";
import { SAMPLE_SCRIPT } from "./sample-script";

/** Thrown for every route that would need a device on the network. */
export class StaticModeError extends Error {
  readonly status = 501;
  constructor(path: string) {
    super(`${path} needs a device — unavailable in the static build`);
    this.name = "StaticModeError";
  }
}

const KEY_SOURCE = "shelly-devroom.static.source";
const KEY_MINIFY = "shelly-devroom.static.minify";
const KEY_HISTORY = "shelly-devroom.static.history";
const KEY_SCRIPT_HISTORY = "shelly-devroom.static.scriptHistory";
const MAX_HISTORY = 200;

const byteLen = (s: string) => new TextEncoder().encode(s).length;

/**
 * localStorage can throw outright (private mode, quota, `file://`) rather than
 * merely returning null, so every access is guarded and falls back to an
 * in-memory map for the session — same approach as web/charts/metric-history.ts.
 */
const memory = new Map<string, string>();

function readStore(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    /* fall through to the in-memory mirror */
  }
  return memory.get(key) ?? null;
}

function writeStore(key: string, value: string): void {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* in-memory mirror above is the fallback */
  }
}

function readJson<T>(key: string, fallback: T): T {
  const raw = readStore(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- config

function loadMinify(): MinifyConfig {
  const stored = readJson<Partial<MinifyConfig>>(KEY_MINIFY, {});
  const out: MinifyConfig = { ...DEFAULT_MINIFY };
  for (const key of MINIFY_KEYS) {
    if (typeof stored[key] === "boolean") out[key] = stored[key];
  }
  return out;
}

/**
 * `deviceIp`/`scriptId`/`host`/`port` are kept so the header and options panel
 * render their usual shape; they are inert with no device and no server.
 */
function configPayload() {
  return {
    deviceIp: "",
    scriptId: 0,
    host: "",
    port: 0,
    compiler: "devroom",
    minify: loadMinify(),
  };
}

function patchMinify(body: { minify?: Partial<MinifyConfig> }) {
  if (!body.minify || typeof body.minify !== "object" || Array.isArray(body.minify)) {
    throw new Error("body.minify must be an object of boolean knobs");
  }
  const next = loadMinify();
  let touched = 0;
  // Driven off the shared schema, never a hand-listed subset — same reason as
  // the server's PATCH handler: a key added to shared/minify-options.mjs and
  // rendered by the options panel would otherwise silently never persist.
  for (const key of MINIFY_KEYS) {
    if (key in body.minify) {
      if (typeof body.minify[key] !== "boolean") {
        throw new Error(`minify.${key} must be a boolean`);
      }
      next[key] = body.minify[key] as boolean;
      touched++;
    }
  }
  if (touched === 0) throw new Error("body.minify must include at least one known key");
  writeStore(KEY_MINIFY, JSON.stringify(next));
  return { deviceIp: "", scriptId: 0, host: "", port: 0, compiler: "devroom", minify: next };
}

// ---------------------------------------------------------------- source

function loadSource(): string {
  const stored = readStore(KEY_SOURCE);
  if (stored !== null) return stored;
  writeStore(KEY_SOURCE, SAMPLE_SCRIPT);
  return SAMPLE_SCRIPT;
}

// -------------------------------------------------------- script history

/**
 * Port of server/script/script-history.ts onto localStorage, so the Save
 * menu's checkpoint/history work offline exactly as they do against the
 * server: same row shape, same 10-slot cap, same coalescing and dedupe
 * rules. Kept here rather than imported because that module is `node:fs`
 * top to bottom — only its *policy* is portable, not its storage.
 */
type ScriptHistoryRow = { id: string; source: string; bytes: number };

const MAX_SCRIPT_HISTORY = 10;
/** Autosave snapshots within this long of the last row are coalesced away. */
const COALESCE_WINDOW_MS = 60_000;

function scriptRows(): ScriptHistoryRow[] {
  return readJson<ScriptHistoryRow[]>(KEY_SCRIPT_HISTORY, []);
}

function appendScriptRow(
  rows: ScriptHistoryRow[],
  source: string,
  now: number,
): ScriptHistoryRow {
  const row = { id: new Date(now).toISOString(), source, bytes: byteLen(source) };
  writeStore(
    KEY_SCRIPT_HISTORY,
    JSON.stringify([...rows, row].slice(-MAX_SCRIPT_HISTORY)),
  );
  return row;
}

/**
 * Snapshots what is about to be overwritten, so a save/restore never destroys
 * the version it replaces. Skipped on a no-op save, on a repeat of the newest
 * row, and inside the coalescing window — an editing burst under autosave's
 * debounce must not consume most of the 10 slots.
 */
function snapshotBeforeWrite(current: string, next: string, now = Date.now()) {
  if (current === next) return;
  const rows = scriptRows();
  const last = rows[rows.length - 1];
  if (last && last.source === current) return;
  if (last && now - new Date(last.id).getTime() < COALESCE_WINDOW_MS) return;
  appendScriptRow(rows, current, now);
}

/** Deliberate user action, so it bypasses the window — but still dedupes. */
function checkpointNow(current: string, now = Date.now()): ScriptHistoryRow | null {
  const rows = scriptRows();
  const last = rows[rows.length - 1];
  if (last && last.source === current) return null;
  return appendScriptRow(rows, current, now);
}

/**
 * Set by file-io when the user opens a `.js` — it only picks `allowJs` in
 * transpile.ts, nothing else, so `.ts` stays the default.
 */
let sourceKind: "ts" | "js" = "ts";
export function setStaticSourceKind(kind: "ts" | "js"): void {
  sourceKind = kind;
}

// ------------------------------------------------------------- artifacts

/** Last build's `dist/*`, kept in memory only — a reload rebuilds from source. */
let artifacts: Record<string, string> = {};
let artifactMtime = new Date().toISOString();

function artifactList() {
  const ORDER = ["debug.raw.js", "debug.js", "debug.adv.js", "prod.raw.js", "prod.js", "prod.adv.js"];
  return ORDER.filter((n) => n in artifacts).map((name) => ({
    name,
    bytes: new TextEncoder().encode(artifacts[name]).length,
    mtime: artifactMtime,
  }));
}

function storeArtifacts(result: BuildResult): void {
  const next: Record<string, string> = {};
  for (const variant of ["debug", "prod"] as const) {
    const v = result[variant];
    next[`${variant}.raw.js`] = v.raw;
    next[`${variant}.js`] = v.min;
    if (v.adv !== undefined) next[`${variant}.adv.js`] = v.adv;
  }
  // Mirrors build-shelly.mjs's writeLogMap: only present when shortening actually
  // produced entries. Not in artifactList()'s ORDER, so it never shows up in the
  // artifact preview dropdown — only reachable by name, for file-io.ts's downloads.
  if (Object.keys(result.logMap).length > 0) {
    next["prod.logmap.json"] = `${JSON.stringify(result.logMap, null, 2)}\n`;
  }
  artifacts = next;
  artifactMtime = new Date().toISOString();
}

function sizesOf(result: BuildResult) {
  const pair = (v: BuildResult["debug"]) => ({
    raw: v.rawBytes,
    min: v.minBytes,
    ...(v.advBytes === undefined ? {} : { adv: v.advBytes }),
  });
  return { debug: pair(result.debug), prod: pair(result.prod) };
}

// --------------------------------------------------------------- history

type HistoryRow = {
  ts: string;
  sizes: ReturnType<typeof sizesOf>;
  stats?: Record<string, number>;
  memEstimate?: number;
};

/** Mirrors summarizeStats in server/script/build-history.ts — six fields the dashboard charts. */
function summarizeStats(stats: ScriptStats) {
  return {
    apiKinds: Object.keys(stats.apis).length,
    apiCalls: Object.values(stats.apis).reduce((a, b) => a + b, 0),
    vars: stats.declarations.vars,
    consoleLog: stats.logging.consoleLog,
    timers: stats.registrations.timers,
    anonNest: stats.nesting.maxAnonymousDepth,
  };
}

function appendHistory(row: HistoryRow): HistoryRow {
  const rows = readJson<HistoryRow[]>(KEY_HISTORY, []);
  rows.push(row);
  writeStore(KEY_HISTORY, JSON.stringify(rows.slice(-MAX_HISTORY)));
  return row;
}

/** Newest first and clamped 1–100, matching readBuildHistory's contract. */
function readHistory(limit: number): HistoryRow[] {
  const clamped = Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : 20;
  return readJson<HistoryRow[]>(KEY_HISTORY, []).slice(-clamped).reverse();
}

// ------------------------------------------------------------ the router

const DEVICE_PREFIXES = [
  "/api/device",
  "/api/devices",
  "/api/deploy",
  "/api/probe",
  "/api/session",
];

async function statsFor(source: string): Promise<StatsResult> {
  return pipelineRequest<StatsResult>({ type: "stats", source, artifacts });
}

async function route(path: string, init?: RequestInit): Promise<unknown> {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : {};

  if (DEVICE_PREFIXES.some((p) => pathname.startsWith(p))) {
    throw new StaticModeError(pathname);
  }

  // Before the switch: the id is an ISO timestamp, so it can't be a case label.
  if (pathname.startsWith("/api/script/history/")) {
    const id = decodeURIComponent(pathname.slice("/api/script/history/".length));
    const row = scriptRows().find((r) => r.id === id);
    if (!row) throw new Error("unknown history id");
    return { id: row.id, source: row.source };
  }

  switch (pathname) {
    case "/api/config":
      if (method === "PATCH") return { config: patchMinify(body) };
      // The one field the server never sends — what device-section.tsx gates on.
      return { config: configPayload(), devices: [], active: null, static: true };

    case "/api/script":
      if (method === "PUT") {
        if (typeof body.source !== "string") throw new Error("body.source must be a string");
        snapshotBeforeWrite(loadSource(), body.source);
        writeStore(KEY_SOURCE, body.source);
        // Set by file-io.ts (M17.6) when the opened file was .js/.mjs — absent on
        // every other write, which leaves sourceKind at whatever it already was.
        if (body.kind === "ts" || body.kind === "js") setStaticSourceKind(body.kind);
        return { bytes: byteLen(body.source) };
      }
      return { path: "scripts/main.ts", source: loadSource() };

    case "/api/script/history":
      return {
        rows: scriptRows()
          .map((r) => ({ id: r.id, bytes: r.bytes, ts: r.id }))
          .reverse(),
      };

    case "/api/script/checkpoint": {
      const row = checkpointNow(loadSource());
      return { created: row !== null, id: row?.id ?? null };
    }

    case "/api/script/restore": {
      if (typeof body.id !== "string") throw new Error("body.id must be a string");
      const row = scriptRows().find((r) => r.id === body.id);
      if (!row) throw new Error("unknown history id");
      snapshotBeforeWrite(loadSource(), row.source);
      writeStore(KEY_SOURCE, row.source);
      return { bytes: byteLen(row.source) };
    }

    case "/api/build": {
      // Builds the last *saved* source, not the editor buffer — same as the
      // server, which compiles scripts/main.ts off disk.
      const source = loadSource();
      const result = await pipelineRequest<BuildResult>({
        type: "build",
        source,
        kind: sourceKind,
        minify: loadMinify(),
        deviceProfile: {},
      });
      storeArtifacts(result);
      const sizes = sizesOf(result);
      const s = await statsFor(source);
      const historyRow = appendHistory({
        ts: new Date().toISOString(),
        sizes,
        stats: summarizeStats(s.stats),
        memEstimate: s.estimate.bytes,
      });
      // `dialect` is deliberately absent: the post-compile guard runs as part
      // of Check over these same artifacts, and app.tsx already treats the
      // field as optional.
      return {
        sizes,
        stats: s.stats,
        variants: s.variants,
        estimate: s.estimate,
        minFirmware: s.minFirmware,
        historyRow,
        stdout: "",
        stderr: "",
      };
    }

    case "/api/check": {
      const report = await pipelineRequest<CheckReport>({
        type: "check",
        source: loadSource(),
        artifacts,
      });
      return { report };
    }

    case "/api/checks":
      return { groups: CHECK_GROUPS, checks: CHECK_CATALOG };

    case "/api/stats": {
      const s = await statsFor(loadSource());
      return { stats: s.stats, variants: s.variants, estimate: s.estimate, minFirmware: s.minFirmware };
    }

    case "/api/history":
      return { history: readHistory(Number(params.get("limit") ?? 20)) };

    case "/api/artifacts":
      return { artifacts: artifactList() };

    case "/api/artifact": {
      const name = params.get("name") ?? "";
      const code = artifacts[name];
      if (code === undefined) throw new Error("unknown or unbuilt artifact");
      return { name, bytes: new TextEncoder().encode(code).length, code };
    }

    default:
      throw new Error(`no static handler for ${pathname}`);
  }
}

/** Drop-in for web/lib/api.ts's `api()` — same signature, same `ok` envelope. */
export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T & { ok: boolean; error?: string }> {
  const data = await route(path, init);
  return { ok: true, ...(data as object) } as T & { ok: boolean; error?: string };
}

/** Static equivalent of web/lib/api.ts's streamed Check transport. */
export async function apiStream<T>(
  path: string,
  _init: RequestInit | undefined,
  onProgress: (progress: CheckProgress) => void,
): Promise<T> {
  if (path !== "/api/check/stream") {
    throw new Error(`no static stream handler for ${path}`);
  }
  const report = await pipelineRequest<CheckReport>(
    { type: "check", source: loadSource(), artifacts },
    onProgress,
  );
  return report as T;
}
