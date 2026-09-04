/**
 * Probe catalog tests. The point of this file is the hardware guard: every probe
 * expression must be side-effect-free, because `mise run probe` evaluates them
 * inside a script on the user's real device.
 * Usage: node --import tsx scripts/test-probe-catalog.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PROBES } from "../server/probe/probe-catalog.ts";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const eq = (got, want, what) => {
  if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const byId = new Map(PROBES.map((p) => [p.id, p]));

// P1 — ids are unique, and the five originals keep their exact expressions so
// the committed report and its consumers stay valid.
{
  eq(byId.size, PROBES.length, "probe ids must be unique");

  const original = {
    "array.map": "typeof [].map",
    "string.padStart": 'typeof "".padStart',
    print: "typeof print",
    setTimeout: "typeof setTimeout",
    Timer: "typeof Timer",
  };
  for (const [id, code] of Object.entries(original)) {
    const probe = byId.get(id);
    if (!probe) fail(`original probe "${id}" is missing from the catalog`);
    eq(probe.code, code, `original probe "${id}" expression`);
  }
}

// P2 — the hardware guard. No probe may call a device method, mutate a device
// namespace, or name a mutating RPC verb in a call position.
{
  const DENIED_VERBS = [
    "set",
    "put",
    "create",
    "delete",
    "start",
    "stop",
    "reboot",
    "update",
    "add",
    "remove",
    "clear",
    "emit",
    "write",
    "send",
    "post",
    "request",
    "subscribe",
    "publish",
    "register",
    "eval",
  ];
  const NAMESPACES = [
    "Shelly",
    "Script",
    "Timer",
    "MQTT",
    "BLE",
    "AES",
    "HTTPServer",
    "Virtual",
  ];
  // Documented synchronous, no-RPC lookups — safe to call on real hardware,
  // unlike the rest of the namespaced surface (which is Shelly.call/RPC-backed).
  const SAFE_NAMESPACE_CALLS = ["Virtual.getHandle"];

  for (const p of PROBES) {
    for (const m of p.code.matchAll(/([A-Za-z_$][\w$.]*)\s*\(/g)) {
      const callee = m[1].toLowerCase();
      const hit = DENIED_VERBS.find((v) => callee.includes(v));
      if (hit) fail(`probe "${p.id}" calls ${m[1]}() — "${hit}" is a mutating verb`);
    }

    const nsCall = new RegExp(`\\b(${NAMESPACES.join("|")})\\.?[\\w$.]*\\s*\\(`, "g");
    for (const m of p.code.matchAll(nsCall)) {
      const call = m[0].slice(0, -1).trim();
      if (SAFE_NAMESPACE_CALLS.includes(call)) continue;
      fail(`probe "${p.id}" calls into ${m[1]} — probes may only read properties`);
    }

    const assigned = /[A-Za-z_$][\w$]*(\.[\w$]+)+\s*=[^=]/.exec(p.code);
    if (assigned) fail(`probe "${p.id}" assigns to ${assigned[0]} — probes must not write`);

    if (/\+\+|--/.test(p.code)) fail(`probe "${p.id}" mutates with ++/--`);
    if (/\bdelete\s/.test(p.code)) fail(`probe "${p.id}" uses delete`);
  }
}

// P3 — shape: every probe is grouped, and expressions stay small enough to
// travel as an RPC param onto a memory-constrained device.
{
  const MAX_CODE = 240;
  for (const p of PROBES) {
    if (typeof p.group !== "string" || p.group.length === 0) {
      fail(`probe "${p.id}" has no group`);
    }
    if (typeof p.code !== "string" || p.code.length === 0) {
      fail(`probe "${p.id}" has no code`);
    }
    if (p.code.length > MAX_CODE) {
      fail(`probe "${p.id}" is ${p.code.length} chars, cap is ${MAX_CODE}`);
    }
    if (p.note !== undefined && (typeof p.note !== "string" || p.note.length === 0)) {
      fail(`probe "${p.id}" has an empty note`);
    }
  }
}

// P4 — the parser probes (nesting ceiling, hoisting) must be well-formed
// self-contained expressions that yield a string. Node's answers are not the
// device's answers; this only proves the expression is not malformed.
{
  const parser = PROBES.filter((p) => p.group === "parser");
  if (parser.length < 6) fail(`expected the nesting and hoisting probes, got ${parser.length}`);

  for (const p of parser) {
    let got;
    try {
      got = eval(p.code);
    } catch (e) {
      fail(`probe "${p.id}" does not even evaluate in Node: ${e}`);
    }
    if (typeof got !== "string" || got.length === 0) {
      fail(`probe "${p.id}" must evaluate to a string, got ${JSON.stringify(got)}`);
    }
  }

  eq(byId.get("nesting.anon.depth3").code.split("function").length - 1, 3, "depth3 nests 3");
  // Node hoists, so these are the ES answers the device is compared against.
  eq(eval(byId.get("hoisting.function-decl").code), "function", "Node hoists declarations");
  eq(eval(byId.get("hoisting.call").code), "called", "Node calls a later declaration");
  eq(eval(byId.get("hoisting.var").code), "undefined", "Node hoists var without its value");
}

// P5 — probe.ts iterates this catalog and nothing else. Source-level check, so
// the test never reaches for the device.
{
  const src = readFileSync(new URL("../server/probe/probe.ts", import.meta.url), "utf8");
  if (!/import \{ PROBES \} from "\.\/probe-catalog\.ts";/.test(src)) {
    fail("server/probe/probe.ts must import PROBES from catalog");
  }
  if (!/for \(const p of PROBES\)|PROBES\[index\]/.test(src)) {
    fail("runProbe must iterate PROBES");
  }
  if (/const PROBES/.test(src)) fail("server/probe/probe.ts still declares its own PROBES");
}

// P6 — dotted globals must catch a missing root. `typeof Script.id` threw on
// fw 1.4.99, stopping its scratch host and invalidating every later answer.
{
  const guarded = PROBES.filter((p) => p.code.startsWith("(function(){try{return typeof "));
  if (guarded.length !== 28) fail(`expected 28 guarded dotted probes, got ${guarded.length}`);

  for (const p of guarded) {
    let answer;
    try {
      answer = vm.runInNewContext(p.code, Object.create(null));
    } catch (e) {
      fail(`guarded probe "${p.id}" threw: ${e}`);
    }
    if (typeof answer !== "string") {
      fail(`guarded probe "${p.id}" returned ${JSON.stringify(answer)}, not a string`);
    }
  }
  if (!String(vm.runInNewContext(byId.get("Script.id").code, Object.create(null))).startsWith("throws:")) {
    fail("Script.id must report a missing root as throws:");
  }
}

// P7 — every guarded member has a bare root check. A missing root is unknown,
// not evidence that a same-named property is absent from every object.
{
  for (const probe of PROBES.filter((entry) => entry.code.startsWith("(function(){try{return typeof "))) {
    const root = probe.id.split(".")[0];
    const rootProbe = byId.get(root);
    if (!rootProbe || rootProbe.code !== `typeof ${root}`) {
      fail(`guarded probe "${probe.id}" has no bare root probe for ${root}`);
    }
  }
}

const groups = {};
for (const p of PROBES) groups[p.group] = (groups[p.group] ?? 0) + 1;
console.log(`probe catalog: ${PROBES.length} probes ok ${JSON.stringify(groups)}`);
