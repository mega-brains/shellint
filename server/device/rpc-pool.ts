import { runtime } from "#shellint/runtime";
import { ShellyRpc, type RpcTarget } from "./rpc.ts";

/**
 * Shelly documents six non-persistent RPC channels. WebSocket RPC is
 * persistent, so this smaller cap is an operational safeguard, not a device
 * guarantee. `/debug/log` uses a separate endpoint and is not counted here.
 */
const DEFAULT_MAX_DEVICE_SOCKETS = 2;
const DEFAULT_QUEUE_TIMEOUT_MS = 2_000;
const IDLE_MS = 30_000;

function positiveEnv(name: string, fallback: number): number {
  const value = Number(runtime.process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const MAX_DEVICE_SOCKETS = positiveEnv(
  "SHELLINT_MAX_DEVICE_SOCKETS",
  DEFAULT_MAX_DEVICE_SOCKETS,
);
export const RPC_QUEUE_TIMEOUT_MS = positiveEnv(
  "SHELLINT_RPC_QUEUE_TIMEOUT_MS",
  DEFAULT_QUEUE_TIMEOUT_MS,
);

export class DeviceBusyError extends Error {
  constructor() {
    super("device busy — try again shortly");
    this.name = "DeviceBusyError";
  }
}

let available = MAX_DEVICE_SOCKETS;
const socketWaiters: Array<() => void> = [];

/** One permit per open `/rpc` socket. Kept here so direct clients are capped too. */
export async function acquireDeviceSocket(): Promise<void> {
  if (available > 0) {
    available -= 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const waiter = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      const index = socketWaiters.indexOf(waiter);
      if (index >= 0) socketWaiters.splice(index, 1);
      reject(new DeviceBusyError());
    }, RPC_QUEUE_TIMEOUT_MS);
    socketWaiters.push(waiter);
  });
}

export function releaseDeviceSocket(): void {
  const waiter = socketWaiters.shift();
  if (waiter) {
    waiter();
    return;
  }
  available = Math.min(MAX_DEVICE_SOCKETS, available + 1);
}

function targetKey(target: RpcTarget): string {
  return `${target.ip}\u0000${target.auth?.username ?? ""}\u0000${target.auth?.password ?? ""}`;
}

type Entry = {
  target: RpcTarget;
  rpc: ShellyRpc;
  leased: boolean;
  waiters: Array<() => void>;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

const entries = new Map<string, Entry>();

export type RpcLease = {
  rpc: ShellyRpc;
  release(): void;
};

/** Adapts an exclusive lease to legacy connect/call/close factory seams. */
export type PooledRpc = {
  connect(): Promise<void>;
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
};

function wake(entry: Entry): void {
  const waiter = entry.waiters.shift();
  if (waiter) waiter();
}

function releaseLease(key: string, entry: Entry): void {
  if (entries.get(key) !== entry || !entry.leased) return;
  entry.leased = false;
  wake(entry);
  if (entry.waiters.length > 0) return;
  entry.idleTimer = setTimeout(() => {
    if (entry.leased || entry.waiters.length > 0) return;
    entries.delete(key);
    entry.rpc.close();
  }, IDLE_MS);
  // Node's reaper is housekeeping, not work that should keep a CLI alive.
  (entry.idleTimer as unknown as { unref?: () => void }).unref?.();
}

/** Prefer a new active device over an idle keep-alive from another device. */
function evictIdleConnections(except: string): void {
  for (const [key, entry] of entries) {
    if (key === except || entry.leased) continue;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entries.delete(key);
    entry.rpc.close();
    if (available > 0) return;
  }
}

async function waitForLease(entry: Entry): Promise<void> {
  if (!entry.leased) {
    entry.leased = true;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const waiter = () => {
      clearTimeout(timer);
      entry.leased = true;
      resolve();
    };
    const timer = setTimeout(() => {
      const index = entry.waiters.indexOf(waiter);
      if (index >= 0) entry.waiters.splice(index, 1);
      reject(new DeviceBusyError());
    }, RPC_QUEUE_TIMEOUT_MS);
    entry.waiters.push(waiter);
  });
}

/**
 * Take an exclusive, per-device lease. Calls within one route stay ordered;
 * idle connections survive briefly, avoiding repeated WS and warm-up traffic.
 *
 * `bounded: false` lifts the whole-lease deadline for a caller that holds the
 * device for minutes rather than for one UI request — see `beginRequest`.
 */
export async function acquireRpc(
  target: RpcTarget,
  opts: { bounded?: boolean } = {},
): Promise<RpcLease> {
  const key = targetKey(target);
  let entry = entries.get(key);
  if (!entry) {
    evictIdleConnections(key);
    entry = {
      target,
      rpc: new ShellyRpc(target),
      leased: false,
      waiters: [],
      idleTimer: null,
    };
    entries.set(key, entry);
  }
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
  await waitForLease(entry);
  try {
    entry.rpc.beginRequest(opts.bounded !== false);
    await entry.rpc.connect();
  } catch (error) {
    releaseLease(key, entry);
    entries.delete(key);
    entry.rpc.close();
    throw error;
  }
  let released = false;
  return {
    rpc: entry.rpc,
    release() {
      if (released) return;
      released = true;
      releaseLease(key, entry);
    },
  };
}

export function pooledRpc(target: RpcTarget): PooledRpc {
  let lease: RpcLease | null = null;
  return {
    async connect() {
      if (!lease) lease = await acquireRpc(target);
    },
    async call(method, params = {}) {
      if (!lease) throw new Error("WebSocket not connected");
      return lease.rpc.call(method, params);
    },
    close() {
      lease?.release();
      lease = null;
    },
  };
}

/** Read-only request coalescing. Writes must never join another caller. */
const READ_METHODS = new Set([
  "Script.List",
  "Script.GetStatus",
  "Shelly.GetDeviceInfo",
  "Sys.GetStatus",
  "Sys.GetConfig",
  "WiFi.GetStatus",
  "Shelly.ListMethods",
  "Shelly.GetComponents",
  "Script.GetCode",
]);
const reads = new Map<string, Promise<unknown>>();

export function coalesceRead<T>(
  key: string,
  method: string,
  work: () => Promise<T>,
): Promise<T> {
  if (!READ_METHODS.has(method)) return work();
  const existing = reads.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = work().finally(() => reads.delete(key));
  reads.set(key, pending);
  return pending;
}

export function withRpcRead<T>(
  key: string,
  target: RpcTarget,
  method: string,
  work: (rpc: ShellyRpc) => Promise<T>,
): Promise<T> {
  return coalesceRead(key, method, async () => {
    const lease = await acquireRpc(target);
    try {
      return await work(lease.rpc);
    } finally {
      lease.release();
    }
  });
}

export function _poolState(): { available: number; entries: number; waiting: number } {
  return { available, entries: entries.size, waiting: socketWaiters.length };
}

export function _resetPool(): void {
  for (const entry of entries.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.rpc.close();
  }
  entries.clear();
  reads.clear();
  socketWaiters.length = 0;
  available = MAX_DEVICE_SOCKETS;
}
