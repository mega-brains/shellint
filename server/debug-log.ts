import WebSocket from "ws";
import { loadConfig, assertDevroomCompiler } from "./config.ts";
import { AuthNotSupportedError, ShellyRpc } from "./rpc.ts";

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
};

const MAX_LINES = 500;
const MAX_METRICS = 1000;
const CONNECT_TIMEOUT_MS = 5_000;

/** `#m <series> <value>`, anywhere in the line — device log lines carry file/line noise. */
const METRIC_RE = /(?:^|\s)#m\s+(\S+)\s+(\S+)/;

type StoredMetric = MetricPoint & { seq: number };

const lines: LogLine[] = [];
const metrics: StoredMetric[] = [];
let headSeq = 0;
/** Highest seq evicted from the ring — a reader below this missed entries. */
let evictedSeq = 0;

let socket: WebSocket | null = null;
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

async function enableDeviceDebug(deviceIp: string): Promise<EnableResult> {
  const rpc = new ShellyRpc(deviceIp);
  try {
    await rpc.connect();
    const result = (await rpc.call("Sys.SetConfig", {
      config: { debug: { websocket: { enable: true } } },
    })) as Record<string, unknown>;
    return { enabled: true, restartRequired: result.restart_required === true };
  } catch (e) {
    const error =
      e instanceof AuthNotSupportedError
        ? `${e.message} — cannot enable debug logging on ${deviceIp}`
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
    const ws = new WebSocket(url);
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
        ws.terminate();
      } catch {
        /* ignore */
      }
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: `connect timeout to ${url} (${CONNECT_TIMEOUT_MS}ms)` });
      drop();
    }, CONNECT_TIMEOUT_MS);

    ws.on("open", () => {
      if (gen !== generation) {
        drop();
        finish({ ok: false, error: "log stream stopped while connecting" });
        return;
      }
      socket = ws;
      connected = true;
      finish({ ok: true });
    });

    ws.on("message", (data) => ingest(data.toString()));

    ws.on("error", (err) => {
      finish({ ok: false, error: `${url}: ${msg(err)}` });
      drop();
    });

    ws.on("close", () => {
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
  let deviceIp: string;
  try {
    const cfg = loadConfig();
    assertDevroomCompiler(cfg);
    deviceIp = cfg.deviceIp;
  } catch (e) {
    return { connected: false, enabledDebug: false, restartRequired: false, error: msg(e) };
  }

  const enable = await enableDeviceDebug(deviceIp);
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

  const opened = await openLogSocket(deviceIp, gen);
  return {
    connected: opened.ok,
    enabledDebug: true,
    restartRequired,
    ...(opened.ok ? {} : { error: opened.error }),
  };
}

export async function startLogStream(): Promise<LogStreamStart> {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return { connected: true, enabledDebug, restartRequired };
  }
  if (starting) return starting;
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
  };
}

export { AuthNotSupportedError };
