/**
 * Probe-driven typings + lint tests: what the device probe answered turns into
 * an advisory types/generated.d.ts and into `probe-absent-api` findings.
 * Usage: node --import tsx scripts/test-typings.mjs
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import {
  generateTypings,
  probeOrigin,
  readProbeReport,
  readProbeVerdicts,
  writeGeneratedTypings,
} from "../server/probe-typings.ts";
import { lintProbe } from "../server/lint-probe.ts";
import { PROBE_PATH } from "../server/paths.ts";

// Severity depends on which device (and firmware) the probe came from, so
// every lint call here says so explicitly instead of inheriting whatever
// .devroom has active.
const asForeign = (src, path = PROBE_PATH) => lintProbe(src, "scripts/main.ts", path, null);
// The active device must match the fixture's own id and firmware for T3b's
// "active device, current firmware" case to land on `error`.
const asActive = (src, path = PROBE_PATH) =>
  lintProbe(src, "scripts/main.ts", path, {
    id: probedDeviceId,
    ip: probedDeviceIp,
    ver: probedFirmware,
  });

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const eq = (got, want, what) => {
  if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const verdictOf = (verdicts, id) => verdicts.find((v) => v.id === id);

// The committed probe fixture is re-generated from time to time (a different
// device, IP, and firmware) — read those instead of hardcoding them.
const probeReport = readProbeReport();
const probedDeviceIp = probeReport?.deviceIp;
if (!probedDeviceIp) fail("types/generated-probe.json should have a deviceIp");
const probedDeviceId = probeReport?.deviceId;
if (!probedDeviceId) fail("types/generated-probe.json should have a deviceId");
const probedFirmware = probeOrigin(probeReport).match(/fw (\S+),/)?.[1];
if (!probedFirmware) fail("could not determine the probed firmware version");

// T1 — the repo's real probe answers.
{
  const verdicts = readProbeVerdicts();
  if (!verdicts.length) fail("types/generated-probe.json should yield verdicts");

  eq(verdictOf(verdicts, "array.map")?.present, true, "array.map is present");
  eq(verdictOf(verdicts, "string.padStart")?.present, false, "string.padStart is absent");
  eq(verdictOf(verdicts, "setTimeout")?.present, false, "setTimeout is absent");
  eq(verdictOf(verdicts, "string.padStart")?.result, "undefined", "raw answer kept");
  eq(verdictOf(verdicts, "nope.nothing"), undefined, "unprobed ids get no verdict");
}

// T2 — the generated .d.ts declares the confirmed surface and parses clean.
{
  const { dts, present, absent } = generateTypings();
  if (!present.includes("array.map")) fail("array.map should be generated");
  if (!absent.includes("string.padStart")) fail("string.padStart should be listed absent");

  if (!/advisory/i.test(dts)) fail("the header must say the file is advisory");
  if (!dts.includes("mise run probe")) fail("the header must say how to regenerate");
  if (!dts.includes(probedDeviceIp)) fail("the header must name the probed device");

  if (!/\bmap\b/.test(dts)) fail("map should be declared");
  if (dts.includes("padStart")) fail("an absent API must not be declared");
  if (dts.includes("setTimeout")) fail("an absent global must not be declared");

  const sf = ts.createSourceFile("generated.d.ts", dts, ts.ScriptTarget.ES5, true);
  const syntax = sf.parseDiagnostics ?? [];
  if (syntax.length) {
    fail(`generated .d.ts does not parse: ${syntax.map((d) => d.messageText).join("; ")}`);
  }

  // The committed file is the generator's own output.
  const written = writeGeneratedTypings();
  if (!written.path.endsWith("types/generated.d.ts")) fail("wrong output path");
}

// T3 — the lint pass reports only confirmed-absent APIs. A probe from some
// other device stays advisory.
{
  const warned = asForeign('"x".padStart(2," ");');
  eq(warned.length, 1, "padStart use warns once");
  eq(warned[0].rule, "probe-absent-api", "rule id");
  eq(warned[0].severity, "warn", "advisory severity for a foreign probe");
  if (!warned[0].message.includes(probedDeviceIp)) {
    fail("the finding must name the device it came from");
  }
  if (!warned[0].message.includes(probedFirmware)) {
    fail("the finding must name the firmware it came from");
  }
  if (!/advisory/.test(warned[0].message)) {
    fail("a foreign probe must say the finding is advisory");
  }

  eq(asForeign("[1,2].map(f);").length, 0, "a present API is silent");
  eq(asForeign("var x = 1;").length, 0, "unrelated code is silent");
  eq(asForeign("setTimeout(f, 10);").length, 1, "an absent global warns");
  eq(asForeign("Timer.set(1000, false, f);").length, 0, "a present global is silent");
}

// T3b — same absences, but the probe is the active device's: the absence is a
// fact about the deploy target, so it fails the check instead of nagging.
{
  const errored = asActive("setTimeout(f, 10);");
  eq(errored.length, 1, "an absent global on the active device reports once");
  eq(errored[0].severity, "error", "active-device severity");
  if (!/ReferenceError/.test(errored[0].message)) {
    fail("an active-device finding must say what happens at runtime");
  }
  if (/advisory/.test(errored[0].message)) {
    fail("an active-device finding must not call itself advisory");
  }
  if (!errored[0].message.includes(probedDeviceIp)) {
    fail("the finding must still name the device it came from");
  }

  eq(asActive('"x".padStart(2," ");')[0].severity, "error", "members escalate too");
  eq(asActive("[1,2].map(f);").length, 0, "a present API stays silent");

  // A different active device leaves the probe foreign, whatever its answers.
  const other = lintProbe(
    "setTimeout(f, 10);",
    "scripts/main.ts",
    PROBE_PATH,
    { id: "other", ip: "10.0.0.1", ver: null },
  );
  eq(other[0].severity, "warn", "another device keeps the finding advisory");

  // Same device, but firmware has moved on since the capture — still advisory,
  // and the message says so (M16 §4.2).
  const stale = lintProbe(
    "setTimeout(f, 10);",
    "scripts/main.ts",
    PROBE_PATH,
    { id: probedDeviceId, ip: probedDeviceIp, ver: "9.9.9" },
  );
  eq(stale[0].severity, "warn", "a firmware mismatch on the right device stays advisory");
  if (!stale[0].message.includes("device now runs 9.9.9")) {
    fail("a same-device firmware mismatch must say what the device runs now");
  }
}

// T4 — no probe report, or an empty one: no typings, no findings, no throw.
{
  const missing = join(tmpdir(), "devroom-no-such-probe.json");
  const empty = generateTypings(missing);
  eq(empty.present.length, 0, "missing report declares nothing");
  eq(empty.absent.length, 0, "missing report reports nothing absent");
  if (!empty.dts.includes("declare namespace")) fail("still emits valid TypeScript");
  eq(readProbeVerdicts(missing).length, 0, "missing report yields no verdicts");
  eq(asForeign('"x".padStart(2," ");', missing).length, 0, "no report, no findings");
  eq(asActive('"x".padStart(2," ");', missing).length, 0, "no report, no findings even for the active device");

  const dir = mkdtempSync(join(tmpdir(), "devroom-probe-"));
  const emptyPath = join(dir, "empty.json");
  writeFileSync(emptyPath, JSON.stringify({ probed: true, results: [] }), "utf8");
  eq(readProbeVerdicts(emptyPath).length, 0, "empty report yields no verdicts");
  eq(generateTypings(emptyPath).present.length, 0, "empty report declares nothing");
  eq(asForeign('"x".padStart(2," ");', emptyPath).length, 0, "empty report, no findings");

  const corruptPath = join(dir, "corrupt.json");
  writeFileSync(corruptPath, "{not json", "utf8");
  eq(readProbeVerdicts(corruptPath).length, 0, "corrupt report yields no verdicts");
  eq(asForeign("setTimeout(f, 10);", corruptPath).length, 0, "corrupt report, no findings");
}

console.log("typings: probe verdicts / generated.d.ts / probe-absent-api lint ok");
