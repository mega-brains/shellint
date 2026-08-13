/**
 * Eco-mode handling around a probe run: what the confirmation dialog's two
 * choices actually do to the device, and what they leave behind. Driven
 * against a fake RPC (like the probe slot-safety checks in test-smoke.mjs) —
 * `disableEcoForProbe` is the whole decision, `runProbe` only sequences it.
 * Usage: node --import tsx scripts/test-probe-eco.mjs
 */
import { disableEcoForProbe } from "../server/probe/probe.ts";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** Answers Sys.GetConfig from its own mutable eco state, so a read-back after
 * a write sees what the write did — exactly what `applyEcoMode` relies on. */
function fakeDevice(eco, { restartRequired = false } = {}) {
  const calls = [];
  return {
    calls,
    async call(method, params) {
      calls.push({ method, params });
      if (method === "Sys.GetConfig") return { device: { eco_mode: eco } };
      if (method === "Sys.SetConfig") {
        eco = params.config.device.eco_mode;
        return { restart_required: restartRequired };
      }
      throw new Error(`unexpected call ${method}`);
    },
    get eco() {
      return eco;
    },
  };
}

const setCalls = (dev) => dev.calls.filter((c) => c.method === "Sys.SetConfig");

// No choice made — the probe must not touch a device config nobody asked it to.
{
  const dev = fakeDevice(true);
  const notes = [];
  if (await disableEcoForProbe(dev, undefined, notes)) {
    fail("no eco choice must not schedule a restore");
  }
  if (dev.calls.length !== 0) fail("no eco choice must issue no RPC at all");
  if (notes.length !== 0) fail("no eco choice must add no notes");
}

// Eco already off: nothing to disable, so nothing to restore afterwards.
{
  const dev = fakeDevice(false);
  const notes = [];
  if (await disableEcoForProbe(dev, "probe-only", notes)) {
    fail("eco already off must not schedule a restore");
  }
  if (setCalls(dev).length !== 0) fail("eco already off must not be written");
  if (notes.length !== 0) fail("eco already off must add no notes");
}

// "for this probe only" — off now, and the caller is told to put it back.
{
  const dev = fakeDevice(true);
  const notes = [];
  if (!(await disableEcoForProbe(dev, "probe-only", notes))) {
    fail("probe-only must schedule a restore");
  }
  const writes = setCalls(dev);
  if (writes.length !== 1 || writes[0].params.config.device.eco_mode !== false) {
    fail("probe-only must write eco_mode:false exactly once: " + JSON.stringify(writes));
  }
  if (dev.eco !== false) fail("probe-only must leave the device with eco off during the run");
  if (!notes.some((n) => n.includes("restored afterwards"))) {
    fail("probe-only must say the change is temporary: " + JSON.stringify(notes));
  }
}

// "from now on" — same write, but no restore is scheduled.
{
  const dev = fakeDevice(true);
  const notes = [];
  if (await disableEcoForProbe(dev, "permanent", notes)) {
    fail("permanent must not schedule a restore");
  }
  if (dev.eco !== false) fail("permanent must turn eco off");
  if (!notes.some((n) => n.includes("left off"))) {
    fail("permanent must say the change sticks: " + JSON.stringify(notes));
  }
}

// A firmware that only applies eco changes after a reboot: the run still
// proceeds (rebooting would drop the connection), but says so.
{
  const dev = fakeDevice(true, { restartRequired: true });
  const notes = [];
  await disableEcoForProbe(dev, "probe-only", notes);
  if (!notes.some((n) => n.startsWith("WARNING") && n.includes("restart"))) {
    fail("a restart_required answer must be surfaced: " + JSON.stringify(notes));
  }
  if (dev.calls.some((c) => c.method === "Shelly.Reboot")) {
    fail("the probe must never reboot the device on its own");
  }
}

console.log("OK: probe eco gate — no-op/off/probe-only/permanent/restart-required");
