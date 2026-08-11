/**
 * Tier-3 minifier tests (T5): the espruino/Esprima pass must shrink code,
 * keep `@meta`, keep RPC property keys, and degrade instead of throwing.
 * Usage: node scripts/test-tier3.mjs
 */
import path from "node:path";
import { minify } from "terser";
import { minifyAdvanced } from "./minify-adv.mjs";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const META = '/* @meta {"virtual":[{"type":"boolean","id":200}]} */';

const FIXTURE = `${META}
var counterValue = 0;
function handleStatus(event) {
  console.log("status changed", event.component);
  counterValue = counterValue + 1;
  Shelly.call("Switch.Set", { id: 0, on: true });
}
Shelly.addStatusHandler(function (ev) {
  handleStatus(ev);
});
`;

// T5.1 — a representative device script minifies, and the result still parses.
const result = await minifyAdvanced(FIXTURE);
if (!result.ok) fail(`fixture did not minify: ${result.reason}`);
if (result.engine !== "espruino-esprima") fail(`unexpected engine ${result.engine}`);

const inBytes = Buffer.byteLength(FIXTURE, "utf8");
const outBytes = Buffer.byteLength(result.code, "utf8");
if (outBytes > inBytes) fail(`tier 3 grew the script: ${inBytes} B -> ${outBytes} B`);

try {
  await minify(result.code, { compress: false, mangle: false });
} catch (err) {
  fail(`tier 3 output does not parse: ${err.message}`);
}

// T5.2 — the virtual-component declarations must reach the device.
if (!result.code.includes(META)) fail("@meta comment was lost");

// T5.3 — no espruino binary must mean "no third size number", not a crash.
const missing = await minifyAdvanced(FIXTURE, {
  bin: path.join("/nonexistent", "espruino-cli.js"),
});
if (missing.ok) fail("a missing binary must not report success");
if (missing.reason !== "espruino not installed") {
  fail(`unexpected reason for a missing binary: ${missing.reason}`);
}

// T5.4 — RPC method names and parameter keys are protocol, not local names:
// mangling them would break the call on-device.
if (!/(["'])Switch\.Set\1/.test(result.code)) fail("RPC method name was altered");
for (const key of ["id", "on", "component"]) {
  if (!new RegExp(`[{,.]\\s*${key}\\s*[:.,)]`).test(result.code)) {
    fail(`property key '${key}' was mangled out of the output`);
  }
}

console.log(`tier3: espruino minify ok (${inBytes} B -> ${outBytes} B), @meta kept`);
