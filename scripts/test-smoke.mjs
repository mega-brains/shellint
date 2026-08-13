/**
 * Server smoke: dialect guard, script stats, lint tiers 1-5, check, probe slot
 * safety, artifact/config/session routes. Usage: node --import tsx scripts/test-smoke.mjs
 */
import { readFileSync } from "node:fs";
import { checkBuildArtifacts, checkDialectSource } from "../server/lint/dialect-check.ts";
import { analyzeScriptFile, analyzeSource } from "../server/script/script-stats.ts";
import { inferChip } from "../server/device/device-status.ts";
import { lintSource } from "../server/lint/lint-source.ts";
import { lintSemantics } from "../server/lint/lint-semantics.ts";
import { lintAdvisories, parseMeta } from "../server/lint/lint-advisories.ts";
import { lintConnected } from "../server/lint/lint-connected.ts";
import { runCheck } from "../server/lint/check.ts";
import { CHECK_CATALOG } from "../server/lint/check-catalog.ts";
import { acquireHost, removeScratch } from "../server/probe/probe.ts";
import { MINIFY_KEYS } from "../shared/minify-options.mjs";
import { createApp } from "../server/app.ts";

const dialect = checkBuildArtifacts();
const bad = dialect.flatMap((r) => r.findings.filter((f) => f.severity === "error"));
if (bad.length) {
  console.error(JSON.stringify(bad, null, 2));
  process.exit(1);
}
const emitted = (src) => new Set(checkDialectSource(src, "emitted.js").findings.map((f) => f.rule));
for (const src of ["var a = o.x, { b } = o;", "var [c] = arr;"]) {
  if (!emitted(src).has("no-destructuring")) {
    throw new Error("dialect guard missed no-destructuring in: " + src);
  }
}
if (emitted("var d = arr[0];").has("no-destructuring")) {
  throw new Error("dialect guard false positive no-destructuring on element access");
}

const stats = analyzeScriptFile();
const timerSample = analyzeSource("Timer.set(1000, false, function () {});", "sample.ts");
if (!timerSample.apis["Timer.set"]) throw new Error("expected Timer.set in sample stats");
const bleSample = analyzeSource(
  "if (ev !== BLE.Scanner.SCAN_RESULT) return;\n" +
    "BLE.Scanner.Start({ duration_ms: BLE.Scanner.INFINITE_SCAN }, function () {});",
  "ble.ts",
);
for (const k of ["BLE.Scanner.SCAN_RESULT", "BLE.Scanner.INFINITE_SCAN", "BLE.Scanner.Start"]) {
  if (!bleSample.apis[k]) throw new Error("expected " + k + " in sample stats");
}
if (bleSample.apis["BLE.Scanner.Start"] !== 1) throw new Error("BLE.Scanner.Start nested members");
if (!bleSample.sites.apis.includes(1) || !bleSample.sites.apis.includes(2)) {
  throw new Error("expected BLE sites on lines 1 and 2");
}
if (inferChip(2, "SNSW") !== "ESP32") throw new Error("inferChip gen2");
if (inferChip(3, "S3SW") !== "ESP32-C3") throw new Error("inferChip gen3");

const rules = (src) => new Set(lintSource(src).map((f) => f.rule));
const has = (src, rule) => {
  if (!rules(src).has(rule)) throw new Error("lint missed " + rule + " in: " + src);
};
const hasNot = (src, rule) => {
  if (rules(src).has(rule)) throw new Error("lint false positive " + rule + " in: " + src);
};

has('var re = /a/g;', "no-regexp");
has('var x = "a".match("b");', "no-regexp");
has("function f() { return Promise.resolve(1); }", "no-async");
has("async function f() { await g(); }", "no-async");
has('import { x } from "y";', "no-modules");
has("function* g() { yield 1; }", "no-generators");
has("var o = { get a() { return 1; } };", "no-accessors");
has('var s = "\\u00e9";', "no-unicode-escapes");
has("for (var i = 0; i < 9; i++) { Timer.set(1000, false, f); }", "no-registration-in-loop");
has(
  "Timer.set(1,0,f);Timer.set(1,0,f);Timer.set(1,0,f);Timer.set(1,0,f);Timer.set(1,0,f);Timer.set(1,0,f);",
  "max-timers",
);
has('Script.addRpcHandler("GetStatus", f);', "no-reserved-rpc-name");
has('Script.storage.setItem("a-very-long-storage-key", "v");', "storage-key-length");

const expect = (fn, src, rule, want) => {
  const hit = new Set(fn(src).map((f) => f.rule)).has(rule);
  if (hit !== want) {
    throw new Error(
      (want ? "lint missed " : "lint false positive ") + rule + " in: " + src,
    );
  }
};
const sem = (src, rule) => expect(lintSemantics, src, rule, true);
const semNot = (src, rule) => expect(lintSemantics, src, rule, false);
const advise = (src) => lintAdvisories(src, "t.ts", "/nonexistent-dist");
const adv = (src, rule) => expect(advise, src, rule, true);
const advNot = (src, rule) => expect(advise, src, rule, false);

// Tier 3 — semantics
// A probed Plus1PM ran 5 nested anonymous functions, so depth 3 is only a warn.
const anonTower = (depth) =>
  "f(" + "function () { g(".repeat(depth - 1) + "function () { h(); }" + ");  }".repeat(depth - 1) + ");";
const anonSeverity = (depth) => {
  const found = lintSemantics(anonTower(depth)).filter((f) => f.rule === "max-anonymous-nesting");
  return found.length ? found[found.length - 1].severity : "none";
};
for (const [depth, want] of [[2, "none"], [3, "warn"], [5, "warn"], [6, "error"]]) {
  const got = anonSeverity(depth);
  if (got !== want) {
    throw new Error("max-anonymous-nesting at depth " + depth + ": got " + got + ", want " + want);
  }
}
sem('Script.addRpcHandler("m", function (req, p) { var x = 1; });', "rpc-handler-must-respond");
semNot('Script.addRpcHandler("m", function (req, p) { req.result({}); });', "rpc-handler-must-respond");
sem(
  'Script.addRpcHandler("m", function (req, p) { req.result(1); req.error(2, "x"); });',
  "rpc-handler-double-respond",
);
sem('HTTPServer.registerEndpoint("/x", function (req, res) { res.code = 200; });', "http-response-must-send");
semNot('HTTPServer.registerEndpoint("/x", function (req, res) { res.send(); });', "http-response-must-send");
sem('for (var i = 0; i < 3; i++) { Shelly.call("Switch.Set", null); }', "no-call-in-loop");
sem("while (true) { work(); }", "no-blocking-loop");
semNot("while (true) { if (x) break; }", "no-blocking-loop");
sem("Timer.set(5, true, f);", "timer-period-min");
semNot("Timer.set(1000, true, f);", "timer-period-min");
sem('Shelly.call("Switch.GetStatus", { id: 0 }, cb);', "prefer-sync-component-access");
semNot('Shelly.getComponentStatus("switch", 0);', "prefer-sync-component-access");
sem('Shelly.call("Switch.Set", null, function (res) { print(res); });', "check-call-error-code");
semNot('Shelly.call("Switch.Set", null, function (res, err) { if (err) print(err); });', "check-call-error-code");
sem("Shelly.addStatusHandler(function (st) { print(st.delta.output); });", "guard-status-delta");
semNot(
  "Shelly.addStatusHandler(function (st) { if (st.delta.output !== undefined) { print(st.delta.output); } });",
  "guard-status-delta",
);
sem("var h = Timer.set(1000, true, f); h = Timer.set(2000, true, f);", "timer-handle-leak");
semNot(
  "var h = Timer.set(1000, true, f); Timer.clear(h); h = Timer.set(2000, true, f);",
  "timer-handle-leak",
);
sem('Shelly.call("Shelly.Reboot", { delay_ms: 100 });', "reboot-delay-min");
semNot('Shelly.call("Shelly.Reboot", { delay_ms: 1000 });', "reboot-delay-min");

// Tier 5 — advisories
adv('console.log("x");', "no-debug-log-in-prod");
advNot('if (meta.env.debug) { console.log("x"); }', "no-debug-log-in-prod");
adv('console.log("x");'.repeat(21), "excessive-console-log");
advNot('console.log("x");'.repeat(3), "excessive-console-log");
adv('var s = "' + "a".repeat(1100) + '";', "prefer-short-strings");
adv("var neverRead = 1; print(1);", "dead-code");
advNot("var used = 1; print(used);", "dead-code");
adv(
  '// @meta {"vc":{"temp":{"type":"number"}}}\nvar h = Script.getVcHandle("humidity");',
  "meta-vc-role-matches",
);
advNot(
  '// @meta {"vc":{"temp":{"type":"number"}}}\nvar h = Script.getVcHandle("temp");',
  "meta-vc-role-matches",
);
if (parseMeta('// @meta {"vc":{"a":{}}}').roles[0] !== "a") {
  throw new Error("parseMeta should read vc roles");
}

if (lintSemantics(readFileSync("scripts/main.ts", "utf8")).length) {
  throw new Error("sample scripts/main.ts should pass Tier 3");
}

// Tier 4 — capability profile of a Gen2 Plus1PM on fw 1.7.5 (the dev device)
const gen2 = {
  at: "2026-08-11T00:00:00.000Z",
  deviceIp: "192.168.2.209",
  gen: 2,
  ver: "1.7.5",
  model: "SNSW-001P16EU",
  app: "Plus1PM",
  methods: ["Switch.Set", "Switch.GetStatus", "Shelly.GetDeviceInfo", "Sys.GetStatus"],
  components: ["switch:0", "input:0", "sys", "script:1"],
};
const gen3 = { ...gen2, gen: 3, ver: "2.0.0", methods: [...gen2.methods, "Virtual.Add"] };
const conRules = (src, profile) =>
  new Set(lintConnected(src, profile ?? gen2, "t.ts").map((f) => f.rule));
const hasCon = (src, rule, profile) => {
  if (!conRules(src, profile).has(rule)) {
    throw new Error("connected lint missed " + rule + " in: " + src);
  }
};
const hasNotCon = (src, rule, profile) => {
  if (conRules(src, profile).has(rule)) {
    throw new Error("connected lint false positive " + rule + " in: " + src);
  }
};

hasCon('Shelly.call("Swtich.Set", { id: 0 });', "no-unknown-rpc-method");
hasCon('Shelly.call("switch.set", { id: 0 });', "no-unknown-rpc-method");
hasNotCon('Shelly.call("Switch.Set", { id: 0 });', "no-unknown-rpc-method");
hasCon('Shelly.call("Switch.Set", { id: 3 });', "component-exists");
hasNotCon('Shelly.call("Switch.Set", { id: 0 });', "component-exists");
hasCon('Shelly.getComponentStatus("cct", 0);', "component-exists");
hasNotCon('Shelly.getComponentStatus("switch:0");', "component-exists");
// Singletons are listed without an index; both spellings address the same one.
hasNotCon('Shelly.getComponentStatus("sys");', "component-exists");
hasNotCon('Shelly.getComponentStatus("sys", 0);', "component-exists");
hasNotCon('Shelly.getComponentStatus("wifi");', "component-exists");
hasCon('Shelly.getComponentStatus("sys", 1);', "component-exists");
hasCon("AES.encrypt(k, d);", "require-capability-aes");
hasNotCon("AES.encrypt(k, d);", "require-capability-aes", gen3);
hasCon('Virtual.getHandle("number:200");', "require-capability-virtual");
hasNotCon('Virtual.getHandle("number:200");', "require-capability-virtual", gen3);
hasCon('// @meta {"vc":{"t":{}}}\nvar h = 1;', "require-capability-meta-vc");
hasNotCon('// @meta {"vc":{"t":{}}}\nvar h = 1;', "require-capability-meta-vc", gen3);
hasNotCon('Script.storage.setItem("k", "v");', "require-capability-storage");
hasCon("LNM.getStatus();", "warn-preview-api");
// Not asserted against scripts/main.ts itself: that file is the user's live
// editor buffer (currently a Victron BLE/AES/Virtual script), not a fixture —
// Tier 4 coverage above already exercises every rule against a synthetic
// profile matched to what it checks.

// tsc down-levels these; only the post-compile guard should complain
hasNot("var f = function () { return 1; };", "no-arrow-functions");
hasNot("var f = () => 1;", "no-arrow-functions");
hasNot("var s = `hi`;", "no-template-literals");

if (lintSource(readFileSync("scripts/main.ts", "utf8")).length) {
  throw new Error("sample scripts/main.ts should lint clean");
}

// Probe must never write to or delete a slot that already existed on the device
const fakeDevice = (slots, opts = {}) => {
  const calls = [];
  let nextId = Math.max(0, ...slots.map((s) => s.id)) + 1;
  return {
    calls,
    async call(method, params = {}) {
      calls.push({ method, id: params.id });
      if (method === "Script.List") return { scripts: slots };
      if (method === "Script.GetStatus") {
        const s = slots.find((x) => x.id === params.id);
        return { id: params.id, running: !!s && !!s.running };
      }
      if (method === "Script.Create") {
        if (opts.createFails) throw new Error("no space left on device");
        const id = nextId++;
        slots.push({ id, name: params.name, running: false });
        return { id };
      }
      if (method === "Script.PutCode") return { len: 1 };
      if (method === "Script.Start" || method === "Script.Stop") {
        const s = slots.find((x) => x.id === params.id);
        if (s) s.running = method === "Script.Start";
        return { was_running: false };
      }
      if (method === "Script.Delete") {
        slots.splice(
          slots.findIndex((x) => x.id === params.id),
          1,
        );
        return null;
      }
      throw new Error("unexpected RPC " + method);
    },
  };
};
const assertPreserved = (dev, ids) => {
  const touched = dev.calls.filter(
    (c) =>
      ids.includes(c.id) &&
      ["Script.PutCode", "Script.Delete", "Script.Stop"].includes(c.method),
  );
  if (touched.length) {
    throw new Error("probe touched stored scripts: " + JSON.stringify(touched));
  }
};

const stored = () => [
  { id: 1, name: "user-one", running: false },
  { id: 2, name: "user-two", running: false },
];

const idleDev = fakeDevice(stored());
const idleHost = await acquireHost(idleDev, 1);
if (idleHost.strategy !== "scratch") {
  throw new Error("expected scratch slot when nothing is running");
}
if (idleHost.scratchScriptId !== 3) {
  throw new Error("scratch slot must be a freshly created id, got " + idleHost.scratchScriptId);
}
await removeScratch(idleDev, idleHost.scratchScriptId);
assertPreserved(idleDev, [1, 2]);
if (idleDev.calls.some((c) => c.method === "Script.Delete" && c.id !== 3)) {
  throw new Error("probe deleted a slot it did not create");
}

const fullDev = fakeDevice(
  [
    { id: 1, name: "user-one", running: false },
    { id: 2, name: "user-two", running: true },
  ],
  { createFails: true },
);
const fullHost = await acquireHost(fullDev, 1);
if (fullHost.strategy !== "running-slot" || fullHost.scriptId !== 2) {
  throw new Error("expected read-only fallback into running script 2");
}
if (fullHost.scratchScriptId !== null) throw new Error("fallback must not claim a scratch slot");
assertPreserved(fullDev, [1, 2]);

const runningDev = fakeDevice([{ id: 1, name: "user-one", running: true }]);
const runningHost = await acquireHost(runningDev, 1);
if (runningHost.strategy !== "configured" || runningHost.scriptId !== 1) {
  throw new Error("expected the configured running slot to be used as-is");
}
assertPreserved(runningDev, [1]);
if (runningDev.calls.some((c) => c.method === "Script.Create")) {
  throw new Error("no scratch slot should be created when the configured slot runs");
}

const emptyDev = fakeDevice([], { createFails: true });
let probeThrew = false;
try {
  await acquireHost(emptyDev, 1);
} catch {
  probeThrew = true;
}
if (!probeThrew) throw new Error("probe should fail loudly when it has no slot to use");

const report = await runCheck();
// Every tier-4 rule judges the sample against whichever device is active on
// this machine — `types/device-profile.json` and `types/generated-probe.json`
// are mirrors of local state no test controls, so a Gen2 device makes the
// sample's AES call an error and a Gen3 one does not. Assert on the tiers that
// are deterministic instead; tier 4 is pinned above against fixture profiles,
// and scripts/test-typings.mjs pins both halves of the probe severity split.
const connectedRules = new Set(
  CHECK_CATALOG.filter((c) => c.group === "connected").map((c) => c.rule),
);
const blocking = report.findings.filter(
  (f) => f.severity === "error" && !connectedRules.has(f.rule),
);
if (blocking.length) {
  console.error(JSON.stringify(blocking, null, 2));
  throw new Error("runCheck should pass for the sample script");
}
if (!report.artifacts.length) throw new Error("runCheck should see dist artifacts");

// Artifact preview: the name comes from the browser, so the allowlist is the test.
const app = createApp();
const listed = await (await app.request("/api/artifacts")).json();
if (!listed.artifacts.some((a) => a.name === "prod.js")) {
  throw new Error("artifact list should carry the built prod.js");
}
const artifact = await (await app.request("/api/artifact?name=prod.js")).json();
if (!artifact.code.length || artifact.bytes !== Buffer.byteLength(artifact.code)) {
  throw new Error("artifact read should return the file and its byte length");
}
for (const name of ["../package.json", "devroom.json", "", "prod.js.map"]) {
  const res = await app.request("/api/artifact?name=" + encodeURIComponent(name));
  if (res.status !== 404) throw new Error("artifact route served off-allowlist name: " + name);
}

const statsPayload = await (await app.request("/api/stats")).json();
const v = statsPayload.variants;
if (!v?.source || v.source.apiKinds == null || !v.debugRaw || !v.prodMin) {
  throw new Error("/api/stats must return variants.source + dist counters");
}

// Start/stop the device script: reject a malformed body before any RPC is made,
// so a typo can never reach Script.Start/Stop. The happy path needs a device.
for (const body of ["{}", '{"running":"yes"}', "not json"]) {
  const res = await app.request("/api/device/script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (res.status !== 400) throw new Error("script route accepted bad body: " + body);
}

// Minify options live in devroom.json — GET exposes them; PATCH merges booleans.
{
  const patch = (body) =>
    app.request("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const before = await (await app.request("/api/config")).json();
  if (typeof before.config?.minify?.compress !== "boolean") {
    throw new Error("GET /api/config should include minify knobs");
  }
  const was = before.config.minify.toplevel;
  const flipped = await (await patch({ minify: { toplevel: !was } })).json();
  if (flipped.config.minify.toplevel !== !was) throw new Error("PATCH minify.toplevel");
  await patch({ minify: { toplevel: was } });
  if ((await patch({ minify: { compress: "yes" } })).status !== 400) {
    throw new Error("PATCH /api/config accepted non-boolean");
  }
  // Every knob the options panel renders must be writable: a hand-listed
  // allowlist here once 400'd the newer keys, so the UI toggles never stuck.
  for (const key of MINIFY_KEYS) {
    const prev = before.config.minify[key];
    const res = await patch({ minify: { [key]: !prev } });
    const json = await res.json();
    if (res.status !== 200 || json.config.minify[key] !== !prev) {
      throw new Error(`PATCH /api/config rejected minify.${key} (${res.status})`);
    }
    await patch({ minify: { [key]: prev } });
  }
}

// The active selection must come back id-shaped, exactly like /api/devices —
// returning the device record blanked the header pickers and leaked auth.
{
  const res = await app.request("/api/session/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  // No devices configured on this machine: the route 4xx's, nothing to check.
  if (body.ok) {
    if (typeof body.active?.device !== "string") {
      throw new Error("/api/session/active must return active.device as a device id");
    }
    if (JSON.stringify(body).includes("password")) {
      throw new Error("/api/session/active leaked device credentials");
    }
  }
}

console.log("smoke: dialect/stats/inferChip/lint tier1-5/check/probe-slot-safety/artifacts/config ok");
