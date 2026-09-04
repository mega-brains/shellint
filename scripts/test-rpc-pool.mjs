/** RPC permit, lease and read-coalescing checks. Never opens a real socket. */
import { runtime } from "#shellint/runtime";
import {
  _poolState,
  _resetPool,
  acquireRpc,
  coalesceRead,
} from "../server/device/rpc-pool.ts";
import { AssertionFailed } from "./real-state-guard.mjs";

function assert(ok, message) {
  if (!ok) throw new AssertionFailed(message);
}

const originalConnect = runtime.websocket.connect;
let open = 0;
let peak = 0;
let closes = 0;

class FakeSocket {
  state = "connecting";
  opens = [];
  messages = [];
  errors = [];
  closed = [];

  constructor() {
    queueMicrotask(() => {
      if (this.state !== "connecting") return;
      this.state = "open";
      open += 1;
      peak = Math.max(peak, open);
      for (const listener of this.opens) listener();
    });
  }

  send(raw) {
    const frame = JSON.parse(raw);
    queueMicrotask(() => {
      for (const listener of this.messages) listener(JSON.stringify({ id: frame.id, result: {} }));
    });
  }

  close() {
    if (this.state === "closed") return;
    this.state = "closed";
    open -= 1;
    closes += 1;
    for (const listener of this.closed) listener({ code: 1000, reason: "", wasClean: true });
  }

  abort() {
    this.close();
  }

  onOpen(listener) { this.opens.push(listener); return () => {}; }
  onMessage(listener) { this.messages.push(listener); return () => {}; }
  onError(listener) { this.errors.push(listener); return () => {}; }
  onClose(listener) { this.closed.push(listener); return () => {}; }
}

runtime.websocket.connect = () => new FakeSocket();

try {
  const target = { ip: "192.0.2.10" };
  await Promise.all(Array.from({ length: 10 }, async () => {
    const lease = await acquireRpc(target);
    try {
      await lease.rpc.call("Script.GetStatus", { id: 1 });
    } finally {
      lease.release();
    }
  }));
  assert(peak === 1, `one device must reuse one socket, saw ${peak}`);

  const two = await Promise.all([
    acquireRpc({ ip: "192.0.2.11" }),
    acquireRpc({ ip: "192.0.2.12" }),
  ]);
  assert(peak === 2, `global socket cap opened ${peak} sockets`);
  for (const lease of two) lease.release();

  let reads = 0;
  await Promise.all([
    coalesceRead("same", "Script.List", async () => { reads += 1; return 1; }),
    coalesceRead("same", "Script.List", async () => { reads += 1; return 2; }),
  ]);
  assert(reads === 1, `read coalescing made ${reads} calls`);

  let writes = 0;
  await Promise.all([
    coalesceRead("write", "Script.Create", async () => { writes += 1; return 1; }),
    coalesceRead("write", "Script.Create", async () => { writes += 1; return 2; }),
  ]);
  assert(writes === 2, `write coalescing made ${writes} calls`);

  // A probe holds one lease across PROBES.length sequential evals, which
  // outlast the 15 s per-request deadline a UI call is held to. Clock is
  // skewed rather than slept so the assert stays instant.
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    const bounded = await acquireRpc({ ip: "192.0.2.20" });
    skew += 20_000;
    let boundedRejected = false;
    try {
      await bounded.rpc.call("Script.Eval", { id: 4, code: "typeof Math" });
    } catch {
      boundedRejected = true;
    }
    bounded.release();
    assert(boundedRejected, "a bounded lease must still expire at the deadline");

    skew = 0;
    const long = await acquireRpc({ ip: "192.0.2.21" }, { bounded: false });
    let evals = 0;
    for (let i = 0; i < 116; i += 1) {
      skew += 200; // ~200 ms per eval on an eco-mode Gen3 => ~23 s total
      await long.rpc.call("Script.Eval", { id: 4, code: "typeof Math" });
      evals += 1;
    }
    long.release();
    assert(evals === 116, `unbounded lease completed only ${evals}/116 evals`);
  } finally {
    Date.now = realNow;
  }

  _resetPool();
  assert(_poolState().available === 2, "permits did not drain after reset");
  assert(closes >= 2, `expected graceful closes, saw ${closes}`);
} finally {
  _resetPool();
  runtime.websocket.connect = originalConnect;
}
