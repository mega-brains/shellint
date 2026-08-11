/**
 * Prod log-string shortening + log-viewer re-expansion (T6).
 * Usage: node --import tsx scripts/test-logmap.mjs
 */
import { existsSync } from "node:fs";
import { minify } from "terser";
import { shortenLogStrings } from "./log-shorten.mjs";
import { expandLogText, loadLogMap, LOG_MAP_PATH } from "../server/log-map.ts";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const eq = (got, want, what) => {
  if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// L1 — a long payload is replaced, recorded, and round-trips through the viewer.
{
  const original = "motion detected in hallway";
  const { code, map } = shortenLogStrings(`console.log("${original}", x);`);
  eq(code, 'console.log("L1", x);', "long literal replaced by its id");
  eq(map.L1, original, "map records the original text");
  eq(
    expandLogText("shelly_script.cpp:12 L1 5", map),
    `shelly_script.cpp:12 ${original} 5`,
    "device log line re-expands the id in place",
  );
  eq(expandLogText("L1", map), original, "id alone re-expands");
  eq(expandLogText("XL1 L12 fooL1", map), "XL1 L12 fooL1", "ids must be standalone tokens");
  eq(expandLogText("L9 unmapped", map), "L9 unmapped", "unmapped ids are left alone");
}

// L2 — `#m <series> <value>` is the metric convention; its shape must reach the device.
{
  const src = 'console.log("#m temp", tC);\nprint("#m temp " + tC);\n';
  const { code, map } = shortenLogStrings(src);
  eq(code, src, "metric literals untouched");
  eq(Object.keys(map).length, 0, "metric literals produce no ids");
}

// L3 — shortening must actually save bytes.
{
  const src = 'print("ok");';
  const { code, map } = shortenLogStrings(src);
  eq(code, src, '"ok" is already shorter than an id');
  eq(Object.keys(map).length, 0, "no id minted for a string that would grow");
}

// L4 — identical messages share one id.
{
  const { code, map } = shortenLogStrings(
    'console.log("device rebooted unexpectedly");\nprint("device rebooted unexpectedly");\n',
  );
  eq(code, 'console.log("L1");\nprint("L1");\n', "second occurrence reuses the id");
  eq(Object.keys(map).length, 1, "one id for one message");
}

// L5 — the dangerous failure mode: non-log strings must survive untouched.
{
  const src = [
    'var label = "a fairly long label string";',
    'Shelly.call("Switch.Set", {id: 0, on: true});',
    'var payload = "another long string literal here";',
    'console.log("wrapped: " + label);',
    "console.log(label);",
    'notLogging("a long string that is not a log payload");',
    'console.debug("a long string on an uncounted console method");',
  ].join("\n");
  const { code, map } = shortenLogStrings(src);
  eq(code, src, "only direct arguments of log calls are rewritten");
  eq(Object.keys(map).length, 0, "no ids minted from non-log strings");
}

// L6 — the spliced output must still parse.
{
  const { code } = shortenLogStrings(
    'console.warn("something went sideways");\nconsole.error("and again, sideways");\n',
  );
  eq(code, 'console.warn("L1");\nconsole.error("L2");\n', "ids number by first appearance");
  const parsed = await minify(code, { compress: false, mangle: false });
  if (!parsed.code) fail("shortened output did not survive a no-op terser pass");
}

// L7 — a missing or unreadable map degrades to `{}`.
// Whether dist/prod.logmap.json exists depends on whether the sample script
// has a prod-surviving log call, so nothing here may assume either way.
{
  const map = loadLogMap();
  if (map === null || typeof map !== "object" || Array.isArray(map)) {
    fail("loadLogMap must return a plain record");
  }
  if (!existsSync(LOG_MAP_PATH)) {
    eq(Object.keys(map).length, 0, "absent dist/prod.logmap.json yields {}");
  }
  for (const [id, text] of Object.entries(map)) {
    if (typeof text !== "string") fail(`map entry ${id} is not a string`);
  }
  eq(
    expandLogText("L1 untouched without a map", {}),
    "L1 untouched without a map",
    "an empty map leaves every id alone",
  );
}

console.log("logmap: shorten / metric-safe / dedupe / expand ok");
