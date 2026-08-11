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
  readProbeVerdicts,
  writeGeneratedTypings,
} from "../server/probe-typings.ts";
import { lintProbe } from "../server/lint-probe.ts";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const eq = (got, want, what) => {
  if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const verdictOf = (verdicts, id) => verdicts.find((v) => v.id === id);

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
  if (!dts.includes("192.168.2.209")) fail("the header must name the probed device");

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

// T3 — the lint pass warns only about confirmed-absent APIs.
{
  const warned = lintProbe('"x".padStart(2," ");');
  eq(warned.length, 1, "padStart use warns once");
  eq(warned[0].rule, "probe-absent-api", "rule id");
  eq(warned[0].severity, "warn", "advisory severity");
  if (!warned[0].message.includes("192.168.2.209")) {
    fail("the finding must name the device it came from");
  }
  if (!warned[0].message.includes("1.7.5")) {
    fail("the finding must name the firmware it came from");
  }

  eq(lintProbe("[1,2].map(f);").length, 0, "a present API is silent");
  eq(lintProbe("var x = 1;").length, 0, "unrelated code is silent");
  eq(lintProbe("setTimeout(f, 10);").length, 1, "an absent global warns");
  eq(lintProbe("Timer.set(1000, false, f);").length, 0, "a present global is silent");
}

// T4 — no probe report, or an empty one: no typings, no findings, no throw.
{
  const missing = join(tmpdir(), "devroom-no-such-probe.json");
  const empty = generateTypings(missing);
  eq(empty.present.length, 0, "missing report declares nothing");
  eq(empty.absent.length, 0, "missing report reports nothing absent");
  if (!empty.dts.includes("declare namespace")) fail("still emits valid TypeScript");
  eq(readProbeVerdicts(missing).length, 0, "missing report yields no verdicts");
  eq(lintProbe('"x".padStart(2," ");', "scripts/main.ts", missing).length, 0, "no report, no findings");

  const dir = mkdtempSync(join(tmpdir(), "devroom-probe-"));
  const emptyPath = join(dir, "empty.json");
  writeFileSync(emptyPath, JSON.stringify({ probed: true, results: [] }), "utf8");
  eq(readProbeVerdicts(emptyPath).length, 0, "empty report yields no verdicts");
  eq(generateTypings(emptyPath).present.length, 0, "empty report declares nothing");
  eq(lintProbe('"x".padStart(2," ");', "scripts/main.ts", emptyPath).length, 0, "empty report, no findings");

  const corruptPath = join(dir, "corrupt.json");
  writeFileSync(corruptPath, "{not json", "utf8");
  eq(readProbeVerdicts(corruptPath).length, 0, "corrupt report yields no verdicts");
  eq(lintProbe("setTimeout(f, 10);", "scripts/main.ts", corruptPath).length, 0, "corrupt report, no findings");
}

console.log("typings: probe verdicts / generated.d.ts / probe-absent-api lint ok");
