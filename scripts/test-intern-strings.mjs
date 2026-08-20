/**
 * String-interning pass (scripts/intern-strings.mjs): below-break-even
 * literals left alone, key positions and directive prologue never touched,
 * `#m` metric lines never touched, generated names never collide, output
 * stays parseable ES5 and passes the post-compile dialect guard, and the
 * transform is runtime-transparent (eval before/after, compare output).
 * Usage: node --import tsx scripts/test-intern-strings.mjs
 */
import { minify } from "terser";
import { internStrings } from "./intern-strings.mjs";
import { checkDialectSource } from "../server/lint/dialect-check.ts";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const eq = (got, want, what) => {
  if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// I1 — below break-even (2-use, 4-char string) is left alone entirely.
{
  const src = 'out.push("abcd");\nout.push("abcd");\n';
  const { code, interned, savedBytes } = internStrings(src);
  eq(code, src, "a 2-use 4-char string must not be interned");
  eq(interned, 0, "no group committed");
  eq(savedBytes, 0, "no bytes claimed saved");
}

// I2 — a clearly profitable repeat (RPC method name, well over break-even)
// gets hoisted, and only that group's occurrences are touched.
{
  const src =
    'Shelly.call("Shelly.GetStatus", a);\n' +
    'Shelly.call("Shelly.GetStatus", b);\n' +
    'Shelly.call("Shelly.GetStatus", c);\n';
  const { code, interned, savedBytes } = internStrings(src);
  if (interned !== 1) fail(`expected exactly 1 interned group, got ${interned}`);
  if (savedBytes <= 0) fail(`expected positive savedBytes, got ${savedBytes}`);
  if (!code.startsWith('var V1="Shelly.GetStatus";')) {
    fail(`expected a leading declaration, got: ${code}`);
  }
  if ((code.match(/Shelly\.call\(V1, /g) ?? []).length !== 3) {
    fail(`expected all 3 call sites rewritten to V1: ${code}`);
  }
  if (code.includes('"Shelly.GetStatus"', code.indexOf(";") + 1)) {
    fail(`a raw copy of the interned literal survived past the declaration: ${code}`);
  }
}

// I3 — right at break-even (2 uses of a ~12-char quoted string) nets to
// zero and must be skipped, not interned "for free".
{
  const src = 'out.push("Switch.Set");\nout.push("Switch.Set");\n';
  const { code, interned } = internStrings(src);
  eq(code, src, "break-even (net 0) must be left alone, not interned");
  eq(interned, 0, "break-even group not committed");
}

// I4 — object-literal keys are never interned, even when repeated and long.
{
  const src =
    'var a = { "aVeryLongPropertyKeyName": 1 };\n' +
    'var b = { "aVeryLongPropertyKeyName": 2 };\n' +
    'var c = { "aVeryLongPropertyKeyName": 3 };\n';
  const { code, interned } = internStrings(src);
  eq(code, src, "repeated object-literal keys must never be interned");
  eq(interned, 0, "no group committed for property keys");
}

// I5 — element access via string (`obj["key"]`) is a key position too.
{
  const src =
    'out.push(o["aVeryLongElementAccessKey"]);\n' +
    'out.push(o["aVeryLongElementAccessKey"]);\n' +
    'out.push(o["aVeryLongElementAccessKey"]);\n';
  const { code, interned } = internStrings(src);
  eq(code, src, "element-access string keys must never be interned");
  eq(interned, 0, "no group committed for element access");
}

// I6 — "use strict" (and any directive prologue) is never interned, even
// when the exact same text repeats elsewhere as ordinary data.
{
  const src =
    '"a repeated directive text right here";\n' +
    'print("a repeated directive text right here");\n' +
    'print("a repeated directive text right here");\n';
  const { code, interned } = internStrings(src);
  if (!code.startsWith('"a repeated directive text right here";\n')) {
    fail(`directive prologue literal must survive untouched: ${code}`);
  }
  // The two later, non-prologue occurrences are still fair game.
  if (interned !== 1) fail(`expected the non-prologue pair to be interned once, got ${interned}`);
  if ((code.match(/print\(V\d+\)/g) ?? []).length !== 2) {
    fail(`expected both print() call sites rewritten: ${code}`);
  }
}

// I7 — `#m <series> <value>` metric lines are never touched, whole-arg or
// via a `+` chain, matching log-shorten's own #m exclusion.
{
  const src =
    'print("#m aVeryLongSeriesNameHere " + val);\n' +
    'print("#m aVeryLongSeriesNameHere " + val);\n' +
    'print("#m aVeryLongSeriesNameHere " + val);\n';
  const { code, interned } = internStrings(src);
  eq(code, src, "#m metric chains must never be interned");
  eq(interned, 0, "no group committed for #m literals");
}

// I8 — generated names avoid colliding with an existing identifier: a
// script-defined `V1` must survive, and the interned var must pick a
// different name instead of shadowing/clobbering it.
{
  const src =
    'var V1 = 42;\n' +
    'out.push("Shelly.GetDeviceStatus");\n' +
    'out.push("Shelly.GetDeviceStatus");\n' +
    'out.push(V1);\n';
  const { code, interned } = internStrings(src);
  eq(interned, 1, "one group interned despite the taken V1 name");
  const declCount = (code.match(/var V1\s*=/g) ?? []).length;
  eq(declCount, 1, "the user's own V1 declaration must not be duplicated or shadowed");
  if (!/var V\d+="Shelly\.GetDeviceStatus";/.test(code) || code.includes("var V1=\"Shelly.GetDeviceStatus\";")) {
    fail(`interned name must not be V1 (already taken): ${code}`);
  }
}

// I9 — output still parses as ES5 (Terser round-trip) and passes the
// post-compile dialect guard used on every build artifact.
{
  const src =
    'Shelly.call("Shelly.GetStatus", a);\n' +
    'Shelly.call("Shelly.GetStatus", b);\n' +
    'Shelly.call("Shelly.GetStatus", c);\n';
  const { code } = internStrings(src);
  const parsed = await minify(code, { compress: false, mangle: false, ecma: 5 });
  if (!parsed.code) fail(`interned output did not survive a no-op terser pass: ${code}`);
  const report = checkDialectSource(code, "interned.js");
  const errors = report.findings.filter((f) => f.severity === "error");
  if (errors.length) {
    fail(`dialect guard flagged interned output: ${JSON.stringify(errors)}`);
  }
}

// I10 — runtime equivalence: evaluate the before/after code and compare
// observable output, across the full set of exclusions in one fixture.
{
  const before = [
    'var out = [];',
    'out.push("Shelly.GetStatus");',
    'out.push("Shelly.GetStatus");',
    'out.push("Shelly.GetStatus");',
    'var cfg = { "Shelly.GetStatus": 1 };',
    'out.push(cfg["Shelly.GetStatus"]);',
    'print("#m aLongMetricSeriesName " + 1);',
    'print("#m aLongMetricSeriesName " + 2);',
    'return out;',
  ].join("\n");
  const { code: after, interned } = internStrings(before);
  if (interned < 1) fail("fixture should have produced at least one interned group");

  // Stub print() so the metric calls don't spam stdout during the test.
  const runner = (code) => new Function("print", `${code}`);
  const beforeResult = runner(before)(() => {});
  const afterResult = runner(after)(() => {});
  eq(JSON.stringify(afterResult), JSON.stringify(beforeResult), "before/after runtime output must match");
}

console.log(
  "intern-strings: break-even / keys / directive / #m / collisions / dialect-guard / runtime-equivalence ok",
);
