/** Host-death recovery and in-process probe exclusion. */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROBES } from "../server/probe/probe-catalog.ts";
import { __resetProbeRunState, getProbeRun, ProbeBusyError } from "../server/probe/probe-run.ts";
import { runProbe } from "../server/probe/probe.ts";
import { RpcError } from "../server/device/rpc.ts";
import { _resetCache } from "../server/device/devices.ts";
import { loadCapture } from "../server/probe/probe-store.ts";
import { DEVICE_PROFILE_PATH, PROBE_PATH, ROOT } from "../server/core/paths.ts";
import { GENERATED_DTS_PATH } from "../server/probe/probe-typings.ts";
import { AssertionFailed, restoreOnExit } from "./real-state-guard.mjs";

const state = join(ROOT, ".shellint");
const devicesFile = join(state, "devices.json");
const id = "probe-recovery-test";
const saved = new Map(
  [devicesFile, DEVICE_PROFILE_PATH, PROBE_PATH, GENERATED_DTS_PATH].map((path) => [
    path,
    existsSync(path) ? readFileSync(path, "utf8") : null,
  ]),
);

function fail(message) {
  throw new AssertionFailed(message);
}

function restore() {
  for (const [path, text] of saved) {
    if (text === null) rmSync(path, { force: true });
    else {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, text, "utf8");
    }
  }
  rmSync(join(state, "devices", id), { recursive: true, force: true });
  _resetCache();
  __resetProbeRunState();
}

function seed() {
  mkdirSync(state, { recursive: true });
  writeFileSync(
    devicesFile,
    JSON.stringify({
      version: 1,
      active: { device: id, slot: 1, script: "main" },
      devices: [{ id, label: "fake probe", ip: "127.0.0.1", slots: { "1": { script: "main" } } }],
    }),
    "utf8",
  );
  _resetCache();
  __resetProbeRunState();
}

function fakeDevice({ dieAt = null, failRevive = false, holdFirst = false, configuredRunning = false } = {}) {
  const slots = [{ id: 1, name: "main", running: configuredRunning }];
  const calls = [];
  let nextId = 2;
  let evals = 0;
  let release;
  let started;
  const firstEval = holdFirst ? new Promise((resolve) => { started = resolve; }) : null;
  const handlers = {
    "Shelly.GetDeviceInfo": () => ({ ver: "test", model: "fake", gen: 3 }),
    "Sys.GetConfig": () => ({ device: { eco_mode: false } }),
    "Script.List": () => ({ scripts: slots }),
    "Script.GetStatus": (params) => ({
      running: slots.find((slot) => slot.id === params.id)?.running === true,
    }),
    "Script.Create": (params) => {
      const slotId = nextId++;
      slots.push({ id: slotId, name: params.name, running: false });
      return { id: slotId };
    },
    "Script.PutCode": () => ({}),
    "Script.Start": (params) => {
      const slot = slots.find((item) => item.id === params.id);
      if (failRevive && evals >= dieAt) throw new RpcError(-109, "still stopped");
      if (slot) slot.running = true;
      return {};
    },
    "Script.Stop": () => ({}),
    "Script.Delete": (params) => {
      const index = slots.findIndex((slot) => slot.id === params.id);
      if (index >= 0) slots.splice(index, 1);
      return {};
    },
    "Script.Eval": async (params) => {
      evals += 1;
      if (evals === 1 && firstEval) {
        started();
        await new Promise((resolve) => { release = resolve; });
      }
      const slot = slots.find((item) => item.id === params.id);
      if (evals === dieAt) {
        if (slot) slot.running = false;
        throw new RpcError(-109, "Precondition failed: script not running");
      }
      if (!slot?.running) throw new RpcError(-109, "Precondition failed: script not running");
      return { result: "function" };
    },
  };
  return {
    calls,
    waiting: () => firstEval,
    release: () => release?.(),
    async connect() {},
    close() {},
    async call(method, params = {}) {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected ${method}`);
      return handler(params);
    },
  };
}

const restoreOnce = restoreOnExit(restore);
try {
  seed();
  const dev = fakeDevice({ dieAt: 3 });
  const report = await runProbe({ rpcFactory: () => dev });
  if (report.unevaluated) fail("one recovered host death must keep full coverage");
  if (report.results.length !== PROBES.length) fail("recovered run must include every probe");
  if (!report.notes.some((note) => note.includes("host restarted"))) fail("restart needs report note");
  if (dev.calls.filter((call) => call.method === "Script.Eval").length !== PROBES.length + 1) {
    fail("host-death probe must retry once");
  }

  seed();
  const configured = fakeDevice({ dieAt: 2, configuredRunning: true });
  const repaired = await runProbe({ rpcFactory: () => configured });
  if (!repaired.notes.some((note) => note.startsWith("WARNING") && note.includes("script 1"))) {
    fail("stopped configured script needs restart warning");
  }
  if (configured.calls.some((call) => call.method === "Script.Delete" && call.params.id === 1)) {
    fail("configured host must never be deleted");
  }

  seed();
  const dead = fakeDevice({ dieAt: 1, failRevive: true });
  const partial = await runProbe({ rpcFactory: () => dead });
  if (partial.unevaluated !== PROBES.length) fail("dead host must mark every unknown probe");
  if (partial.results.some((entry) => entry.unevaluated !== "host-dead")) {
    fail("dead host entries need explicit unknown verdicts");
  }
  if (dead.calls.filter((call) => call.method === "Script.Eval").length >= PROBES.length) {
    fail("restart budget must stop dead-host loop early");
  }
  if (!partial.notes.some((note) => note.startsWith("capture kept"))) {
    fail("partial run must preserve fuller capture");
  }
  if ((await loadCapture(id, "test"))?.unevaluated) fail("stored capture must remain full");

  seed();
  const held = fakeDevice({ holdFirst: true });
  const first = runProbe({ rpcFactory: () => held });
  await held.waiting();
  let busy = false;
  try {
    await runProbe({ rpcFactory: () => held });
  } catch (error) {
    busy = error instanceof ProbeBusyError;
  }
  held.release();
  await first;
  if (!busy) fail("second in-process probe must reject while first runs");

  // A run that throws must stay `failed` with its message: runProbe finishes it
  // from both `catch` and `finally`, and the second call must not relabel it.
  seed();
  __resetProbeRunState();
  const boom = "connect timeout to ws://192.0.2.30/rpc (9000ms)";
  try {
    await runProbe({
      rpcFactory: () => ({
        async connect() {
          throw new Error(boom);
        },
        async call() {
          return {};
        },
        close() {},
      }),
    });
    fail("probe with an unreachable device must reject");
  } catch (error) {
    if (error instanceof AssertionFailed) throw error;
  }
  const failedRun = getProbeRun();
  if (failedRun?.phase !== "failed") {
    fail(`failed run reported phase ${failedRun?.phase} instead of "failed"`);
  }
  if (failedRun.error !== boom) fail("failed run must keep its error message");
} finally {
  restoreOnce();
}

console.log("OK: probe recovery and run exclusion");
