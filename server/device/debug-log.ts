import { runtime } from "#devroom/runtime";
import type { RuntimeWebSocket, RuntimeWebSocketMessage } from "../runtime/types.ts";
import { loadConfig, assertDevroomCompiler } from "../core/config.ts";
import { requireActive } from "./devices.ts";
import { AuthNotSupportedError, ShellyRpc, type RpcTarget } from "./rpc.ts";

export type LogLine = { seq: number; ts: number; level: number; text: string };
export type MetricPoint = { ts: number; series: string; value: number };

export type LogStreamStart = {
  connected: boolean;
  enabledDebug: boolean;
  restartRequired: boolean;
  error?: string;
};

export type LogSnapshot = {
  seq: number;
  connected: boolean;
  lines: LogLine[];
  metrics: MetricPoint[];
  dropped: number;
  /** Bumped on every device switch — a poller sees this change and wipes its view. */
  deviceGeneration: number;
};

const MAX_LINES = 500;
const MAX_METRICS = 1000;
const CONNECT_TIMEOUT_MS = 9_000;

function messageText(data: RuntimeWebSocketMessage): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

/** `#m <series> <value>`, anywhere in the line — device log lines carry file/line noise. */
const METRIC_RE = /(?:^|\s)#m\s+(\S+)\s+(\S+)/;

type StoredMetric = MetricPoint & { seq: number };

const lines: LogLine[] = [];
const metrics: StoredMetric[] = [];
let headSeq = 0;
/** Highest seq evicted from the ring — a reader below this missed entries. */
let evictedSeq = 0;

let socket: RuntimeWebSocket | null = null;
let connected = false;
let enabledDebug = false;
let restartRequired = false;
let starting: Promise<LogStreamStart> | null = null;
/** Bumped by every start/stop so a late handshake cannot revive a stopped stream. */
let generation = 0;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function parseMetric(text: string): Omit<MetricPoint, "ts"> | null {
  const m = METRIC_RE.exec(text);
  if (!m) return null;
  const value = Number(m[2]);
  if (!Number.isFinite(value)) return null;
  return { series: m[1], value };
}

function push(line: LogLine): void {
  lines.push(line);
  while (lines.length > MAX_LINES) {
    const gone = lines.shift();
    if (gone) evictedSeq = gone.seq;
  }

  const metric = parseMetric(line.text);
  if (!metric) return;
  metrics.push({ seq: line.seq, ts: line.ts, ...metric });
  while (metrics.length > MAX_METRICS) metrics.shift();
}

function ingest(raw: string): void {
  let frame: { ts?: unknown; level?: unknown; data?: unknown };
  try {
    frame = JSON.parse(raw) as typeof frame;
  } catch {
    return;
  }
  if (typeof frame.data !== "string") return;

  const ts =
    typeof frame.ts === "number" && Number.isFinite(frame.ts)
      ? frame.ts
      : Date.now() / 1000;
  const level = typeof frame.level === "number" ? frame.level : 3;

  for (const part of frame.data.split("\n")) {
    const text = part.replace(/\s+$/, "");
    if (text.length === 0) continue;
    push({ seq: ++headSeq, ts, level, text });
  }
}

type EnableResult = { enabled: boolean; restartRequired: boolean; error?: string };

async function enableDeviceDebug(target: RpcTarget): Promise<EnableResult> {
  const rpc = new ShellyRpc(target);
  try {
    await rpc.connect();
    const result = (await rpc.call("Sys.SetConfig", {
      config: { debug: { websocket: { enable: true } } },
    })) as Record<string, unknown>;
    return { enabled: true, restartRequired: result.restart_required === true };
  } catch (e) {
    const error =
      e instanceof AuthNotSupportedError
        ? `${e.message} — cannot enable debug logging on ${target.ip}`
        : msg(e);
    return { enabled: false, restartRequired: false, error };
  } finally {
    rpc.close();
  }
}

type OpenResult = { ok: true } | { ok: false; error: string };

/** The device serves at most 3 concurrent /debug/log sockets; a 4th is refused here. */
function openLogSocket(deviceIp: string, gen: number): Promise<OpenResult> {
  return new Promise<OpenResult>((resolve) => {
    const url = `ws://${deviceIp}/debug/log`;
    const ws = runtime.websocket.connect(url);
    let settled = false;

    const finish = (r: OpenResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const drop = () => {
      if (socket === ws) {
        socket = null;
        connected = false;
      }
      try {
        ws.abort();
      } catch {
        /* ignore */
      }
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: `connect timeout to ${url} (${CONNECT_TIMEOUT_MS}ms)` });
      drop();
    }, CONNECT_TIMEOUT_MS);

    ws.onOpen(() => {
      if (gen !== generation) {
        drop();
        finish({ ok: false, error: "log stream stopped while connecting" });
        return;
      }
      socket = ws;
      connected = true;
      finish({ ok: true });
    });

    ws.onMessage((data) => ingest(messageText(data)));

    ws.onError((err) => {
      finish({ ok: false, error: `${url}: ${msg(err)}` });
      drop();
    });

    ws.onClose(() => {
      finish({ ok: false, error: `${url} closed before any frame` });
      if (socket === ws) {
        socket = null;
        connected = false;
      }
    });
  });
}

async function begin(): Promise<LogStreamStart> {
  const gen = ++generation;
  let target: RpcTarget;
  try {
    const cfg = await loadConfig();
    assertDevroomCompiler(cfg);
    const active = await requireActive();
    target = { ip: active.device.ip, auth: active.device.auth };
  } catch (e) {
    return { connected: false, enabledDebug: false, restartRequired: false, error: msg(e) };
  }

  const enable = await enableDeviceDebug(target);
  enabledDebug = enable.enabled;
  restartRequired = enable.restartRequired;
  if (!enable.enabled) {
    return {
      connected: false,
      enabledDebug: false,
      restartRequired: enable.restartRequired,
      error: enable.error,
    };
  }

  const opened = await openLogSocket(target.ip, gen);
  return {
    connected: opened.ok,
    enabledDebug: true,
    restartRequired,
    ...(opened.ok ? {} : { error: opened.error }),
  };
}

export async function startLogStream(): Promise<LogStreamStart> {
  if (socket?.state === "open") {
    return { connected: true, enabledDebug, restartRequired };
  }
  if (starting) return starting;
  // A metric series never expires on its own; a fresh connection is the one
  // natural point to drop whatever the previously deployed script was printing.
  metrics.length = 0;
  starting = begin();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

export function stopLogStream(): void {
  generation++;
  const ws = socket;
  socket = null;
  connected = false;
  if (!ws) return;
  try {
    ws.close();
  } catch {
    /* ignore */
  }
}

/**
 * Called on `/api/session/active` — the ring is per-device by construction
 * (one socket), so a switch stops the stream, wipes the buffered lines/
 * metrics, and bumps `generation` so the next `readLogs()` reports
 * `deviceGeneration` changed and the panel wipes instead of interleaving two
 * devices' output.
 */
export function resetForDeviceSwitch(): void {
  stopLogStream();
  lines.length = 0;
  metrics.length = 0;
  headSeq = 0;
  evictedSeq = 0;
}

/**
 * Entries above `sinceSeq`, plus the head seq to poll from next.
 * The device buffer is circular and lossy — oldest lines may never be streamed —
 * so `dropped` is only what *this* ring evicted, and marks a gap the UI must not bridge.
 */
export function readLogs(sinceSeq: number): LogSnapshot {
  const from = Number.isFinite(sinceSeq) ? sinceSeq : 0;
  return {
    seq: headSeq,
    connected,
    lines: lines.filter((l) => l.seq > from),
    metrics: metrics
      .filter((m) => m.seq > from)
      .map((m) => ({ ts: m.ts, series: m.series, value: m.value })),
    dropped: Math.max(0, evictedSeq - from),
    deviceGeneration: generation,
  };
}

export { AuthNotSupportedError };
