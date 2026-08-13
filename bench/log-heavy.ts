/**
 * @title Bench — log-heavy
 * @description Irrigation controller with verbose diagnostics. Benchmark input
 *   for `dropConsole` and `logMap`: dense `console.log` with long literal
 *   messages, both inside and outside `meta.env.debug` guards, so the two
 *   knobs can be told apart (the guarded ones are already gone in prod via DCE;
 *   only the unguarded ones are what `dropConsole` actually buys).
 *   Not shipped, not deployed — see bench/README.md.
 */

const VALVE_COUNT = 4;
const SOAK_MS = 120000;

var runningValve = -1;
var cycleIndex = 0;
var litersThisCycle = 0;
var abortReason = "";

function ts(): string {
  return "" + Math.floor(Shelly.getUptimeMs() / 1000) + "s";
}

// Unguarded: survives meta.env DCE, so it is exactly what dropConsole removes.
function audit(msg: string): void {
  console.log("[irrigation][" + ts() + "] " + msg);
}

// Guarded: DCE already deletes these from the prod artifact regardless of
// dropConsole. Present so the bench separates the two effects.
function trace(msg: string): void {
  if (meta.env.debug) {
    console.log("[irrigation][trace][" + ts() + "] " + msg);
  }
}

function valveKey(id: number): string {
  return "switch:" + id;
}

function openValve(id: number): void {
  trace("openValve entered with id=" + id + " runningValve=" + runningValve);
  if (runningValve >= 0 && runningValve !== id) {
    audit("refusing to open valve " + id + " while valve " + runningValve + " is still running");
    return;
  }
  audit("opening valve " + id + " for cycle " + cycleIndex);
  Shelly.call("Switch.Set", { id: id, on: true }, function (_res, code, msg) {
    if (code !== 0) {
      audit("valve " + id + " failed to open, rpc code " + code + ", message: " + msg);
      abortReason = "valve " + id + " would not open";
      trace("abortReason set to " + abortReason);
      return;
    }
    runningValve = id;
    audit("valve " + id + " confirmed open, starting flow measurement");
    trace("runningValve is now " + runningValve);
  });
}

function closeValve(id: number): void {
  trace("closeValve entered with id=" + id);
  audit("closing valve " + id + " after " + litersThisCycle.toFixed(1) + " liters");
  Shelly.call("Switch.Set", { id: id, on: false }, function (_res, code, msg) {
    if (code !== 0) {
      audit("valve " + id + " failed to close, rpc code " + code + ", message: " + msg);
      audit("this is a wet-failure condition and needs manual intervention at the manifold");
      abortReason = "valve " + id + " would not close";
      return;
    }
    if (runningValve === id) runningValve = -1;
    audit("valve " + id + " confirmed closed, soaking for " + SOAK_MS / 1000 + " seconds");
    trace("runningValve reset to " + runningValve);
  });
}

function readFlow(): number {
  const st = Shelly.getComponentStatus(valveKey(runningValve)) as { apower?: number } | null;
  if (!st) {
    audit("no status for " + valveKey(runningValve) + ", assuming zero flow this sample");
    return 0;
  }
  const p = st.apower;
  if (typeof p !== "number") {
    trace("apower missing or non-numeric on " + valveKey(runningValve));
    return 0;
  }
  trace("apower sample " + p.toFixed(2) + " W on " + valveKey(runningValve));
  return p / 40;
}

function sampleFlow(): void {
  if (runningValve < 0) {
    trace("sampleFlow with no valve running, nothing to do");
    return;
  }
  const liters = readFlow();
  litersThisCycle = litersThisCycle + liters;
  if (liters <= 0) {
    audit("zero flow detected on valve " + runningValve + " — possible dry line or stuck valve");
  }
  if (litersThisCycle > 400) {
    audit("cycle liter budget exceeded (" + litersThisCycle.toFixed(1) + " > 400), aborting cycle");
    abortReason = "liter budget exceeded";
    closeValve(runningValve);
  }
  print("#m liters " + litersThisCycle.toFixed(2));
}

function advanceCycle(): void {
  trace("advanceCycle from index " + cycleIndex);
  if (abortReason !== "") {
    audit("cycle halted, reason recorded as: " + abortReason);
    audit("clearing abort flag and returning to idle until the next scheduled window");
    abortReason = "";
    cycleIndex = 0;
    litersThisCycle = 0;
    return;
  }
  if (runningValve >= 0) {
    closeValve(runningValve);
    trace("closeValve issued, waiting for the soak interval before the next valve");
    return;
  }
  cycleIndex = cycleIndex + 1;
  if (cycleIndex >= VALVE_COUNT) {
    audit("all " + VALVE_COUNT + " valves have run, total " + litersThisCycle.toFixed(1) + " liters");
    audit("irrigation cycle complete, next window is in 24 hours unless rain-delayed");
    cycleIndex = 0;
    litersThisCycle = 0;
    return;
  }
  openValve(cycleIndex);
}

/**
 * Long literals *lexically inside* the log call, unguarded. This is the only
 * shape `logMap` can shorten — the `audit()`/`trace()` wrapper pattern above
 * hands `console.log` a variable, so the map never sees those strings. Both
 * shapes are here on purpose: the delta between them is what the bench is for.
 */
function reportDaily(): void {
  console.log("irrigation daily report follows, all figures are since the last controller restart");
  console.log("total liters delivered across every valve in the current cycle: " + litersThisCycle.toFixed(1));
  console.log("currently running valve index (-1 means the manifold is idle): " + runningValve);
  console.log("cycle index within the configured valve rotation sequence: " + cycleIndex);
  console.log("last recorded abort reason, empty string when the cycle ended cleanly: " + abortReason);
  console.log("configured soak interval between valves, in milliseconds: " + SOAK_MS);
  console.log("configured valve count for this manifold installation: " + VALVE_COUNT);
  // console.error/warn are in log-shorten's LOG_CALLEES but are NOT declared on
  // the device Console type, so they cannot appear here. print() is the other
  // shortenable callee and is cheaper than console.log on device.
  print("if any figure above reads zero unexpectedly, check the flow sensor wiring first");
  print("reminder: the winterisation procedure must be run before the first hard frost");
  console.log("end of irrigation daily report, next report scheduled in twenty four hours");
}

function checkRainDelay(): void {
  Shelly.call("KVS.Get", { key: "irrigation.raindelay" }, function (res, code) {
    if (code !== 0) {
      trace("no rain-delay key in KVS, proceeding as normal");
      return;
    }
    const r = res as { value?: unknown } | null;
    if (r && r.value === true) {
      audit("rain delay is active in KVS, skipping this irrigation window entirely");
      abortReason = "rain delay";
      return;
    }
    trace("rain delay key present but not set, proceeding");
  });
}

Shelly.addEventHandler(function (ev) {
  trace("event on " + ev.component + " name " + ev.name);
  if (ev.info && ev.info.event === "long_push") {
    audit("manual long-push received, aborting the current cycle immediately");
    abortReason = "manual abort";
    if (runningValve >= 0) closeValve(runningValve);
  }
});

audit("irrigation controller starting, " + VALVE_COUNT + " valves configured");
trace("build is debug, verbose tracing is on");
Timer.set(5000, true, sampleFlow);
Timer.set(SOAK_MS, true, advanceCycle);
Timer.set(3600000, true, checkRainDelay);
Timer.set(86400000, true, reportDaily);
