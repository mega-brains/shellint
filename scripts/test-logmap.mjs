/**
 * Prod log-string shortening + log-viewer re-expansion (T6).
 * Usage: node --import tsx scripts/test-logmap.mjs
 */
import { existsSync } from "node:fs";
import { minify } from "terser";
import { shortenLogStrings } from "./log-shorten.mjs";
import { expandLogText, loadLogMap, LOG_MAP_PATH } from "../server/script/log-map.ts";

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
    "console.log(label);",
    'notLogging("a long string that is not a log payload");',
    'console.debug("a long string on an uncounted console method");',
  ].join("\n");
  const { code, map } = shortenLogStrings(src);
  eq(code, src, "only arguments of log calls are rewritten");
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
  const map = await loadLogMap();
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

// L8 — strategy A: string-literal leaf in a `+` chain, with trailing pad.
{
  const { code, map } = shortenLogStrings(
    'console.log(LOG_PREFIX + "found something long " + addr);',
  );
  eq(
    code,
    'console.log(LOG_PREFIX + "L1 " + addr);',
    "concat leaf shortens and keeps trailing whitespace",
  );
  eq(map.L1, "found something long", "map stores core text without pad");
  eq(
    expandLogText("VC: L1 AA:BB", map),
    "VC: found something long AA:BB",
    "padded concat id re-expands as a standalone token",
  );
}

// L9 — strategy B: fold adjacent static literals, then shorten.
{
  const { code, map } = shortenLogStrings(
    'print("scan " + "failed unexpectedly " + err);',
  );
  eq(
    code,
    'print("L1 " + err);',
    "adjacent static literals fold into one shortened piece",
  );
  eq(map.L1, "scan failed unexpectedly", "folded core is mapped");
  eq(
    expandLogText("L1 ECONN", map),
    "scan failed unexpectedly ECONN",
    "folded concat round-trips through expand",
  );
}

// L10 — glued literal without edge whitespace must not shorten (token boundary).
{
  const src = 'console.log("x=" + v);';
  const { code, map } = shortenLogStrings(src);
  eq(code, src, "glued concat leaf without pad is left alone");
  eq(Object.keys(map).length, 0, "no id for glued concat leaf");
}

// L11 — `#m` static left-prefix skips the whole chain.
{
  const src = 'print("#m " + "temp series " + tC);';
  const { code, map } = shortenLogStrings(src);
  eq(code, src, "metric concat chain is untouched");
  eq(Object.keys(map).length, 0, "metric concat produces no ids");
}

// L12 — shared id map across calls (debug + prod build sharing).
{
  const shared = new Map();
  const a = shortenLogStrings('print("shared long message here");', shared);
  const b = shortenLogStrings(
    'console.log(P + "shared long message here ");',
    shared,
  );
  eq(a.map.L1, "shared long message here", "first call mints L1");
  eq(b.code, 'console.log(P + "L1 ");', "second call reuses L1 for same core");
  eq(Object.keys(b.map).length, 1, "shared map stays one entry");
}

console.log("logmap: shorten / concat / metric-safe / dedupe / expand ok");
