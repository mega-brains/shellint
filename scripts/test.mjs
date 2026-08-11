/**
 * Project tests: dual Shelly build + web bundle + dialect/stats smoke.
 * Usage: node scripts/test.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    fail(`${cmd} ${args.join(" ")}\n${r.stderr || r.stdout}`);
  }
  return r;
}

run("npm", ["run", "build:shelly"]);
run("npm", ["run", "build:web"]);

for (const f of [
  "dist/debug.js",
  "dist/prod.js",
  "dist/debug.raw.js",
  "dist/prod.raw.js",
  "web/dist/app.js",
]) {
  if (!existsSync(join(ROOT, f))) fail(`missing ${f}`);
}

const same = (a, b) =>
  readFileSync(join(ROOT, a)).equals(readFileSync(join(ROOT, b)));

if (same("dist/debug.js", "dist/prod.js")) {
  fail("debug and prod min outputs identical (meta.env DCE broken?)");
}
if (same("dist/debug.raw.js", "dist/prod.raw.js")) {
  fail("debug and prod raw outputs identical (meta.env DCE broken?)");
}
if (same("dist/debug.raw.js", "dist/debug.js")) {
  fail("debug raw and min identical (minify noop?)");
}

// The UI wires itself by id, so a renamed element fails only at runtime.
{
  const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const file of readdirSync(join(ROOT, "web")).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(ROOT, "web", file), "utf8");
    for (const m of src.matchAll(/getElementById\("([^"]+)"\)/g)) {
      if (!ids.has(m[1])) fail(`web/${file} looks up #${m[1]}, absent from web/index.html`);
    }
  }
}

const smoke = spawnSync(
  "node",
  [
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    `
import { readFileSync } from "node:fs";
import { checkBuildArtifacts } from "./server/dialect-check.ts";
import { analyzeScriptFile } from "./server/script-stats.ts";
import { inferChip } from "./server/device-status.ts";
import { lintSource } from "./server/lint-source.ts";
import { lintSemantics } from "./server/lint-semantics.ts";
import { lintAdvisories, parseMeta } from "./server/lint-advisories.ts";
import { lintConnected } from "./server/lint-connected.ts";
import { runCheck } from "./server/check.ts";
import { acquireHost, removeScratch } from "./server/probe.ts";

const dialect = checkBuildArtifacts();
const bad = dialect.flatMap((r) => r.findings.filter((f) => f.severity === "error"));
if (bad.length) {
  console.error(JSON.stringify(bad, null, 2));
  process.exit(1);
}
const stats = analyzeScriptFile();
if (!stats.apis["Timer.set"]) throw new Error("expected Timer.set in sample stats");
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
has('var s = "\\\\u00e9";', "no-unicode-escapes");
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
sem(
  'Shelly.call("a", null, function () { Timer.set(1, false, function () { g(function () { h(); }); }); });',
  "max-anonymous-nesting",
);
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
  '// @meta {"vc":{"temp":{"type":"number"}}}\\nvar h = Script.getVcHandle("humidity");',
  "meta-vc-role-matches",
);
advNot(
  '// @meta {"vc":{"temp":{"type":"number"}}}\\nvar h = Script.getVcHandle("temp");',
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
hasCon("AES.encrypt(k, d);", "require-capability-aes");
hasNotCon("AES.encrypt(k, d);", "require-capability-aes", gen3);
hasCon('Virtual.getHandle("number:200");', "require-capability-virtual");
hasNotCon('Virtual.getHandle("number:200");', "require-capability-virtual", gen3);
hasCon('// @meta {"vc":{"t":{}}}\\nvar h = 1;', "require-capability-meta-vc");
hasNotCon('// @meta {"vc":{"t":{}}}\\nvar h = 1;', "require-capability-meta-vc", gen3);
hasNotCon('Script.storage.setItem("k", "v");', "require-capability-storage");
hasCon("LNM.getStatus();", "warn-preview-api");
if (lintConnected(readFileSync("scripts/main.ts", "utf8"), gen2).length) {
  throw new Error("sample scripts/main.ts should pass Tier 4 on the dev device");
}

// tsc down-levels these; only the post-compile guard should complain
hasNot("var f = function () { return 1; };", "no-arrow-functions");
hasNot("var f = () => 1;", "no-arrow-functions");
hasNot("var s = \`hi\`;", "no-template-literals");

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
if (!report.ok) {
  console.error(JSON.stringify(report.findings, null, 2));
  throw new Error("runCheck should pass for the sample script");
}
if (!report.artifacts.length) throw new Error("runCheck should see dist artifacts");

console.log("smoke: dialect/stats/inferChip/lint tier1-5/check/probe-slot-safety ok");
`,
  ],
  { cwd: ROOT, encoding: "utf8" },
);
if (smoke.status !== 0) {
  fail(`server smoke\n${smoke.stderr || smoke.stdout}`);
}
process.stdout.write(smoke.stdout);

console.log("OK: shelly artifacts; web bundle; debug≠prod; raw≠min; server smoke");
