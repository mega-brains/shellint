/**
 * Dashboard metric tests: memory estimate, minimum-firmware badge, debug-log
 * parsing. Split out of test.mjs to keep both files inside the 500-line cap.
 * Usage: node --import tsx scripts/test-dashboard.mjs
 */
import { estimateMemory, estimateMemoryFile } from "../server/memory-estimate.ts";
import { minFirmware } from "../server/min-firmware.ts";
import { parseMetric, readLogs, startLogStream, stopLogStream } from "../server/debug-log.ts";
import { sampleAt, sparkPaths } from "../web/spark.ts";
import { createHistory, WINDOW_MS } from "../web/metric-history.ts";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const eq = (got, want, what) => {
  if (got !== want) fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// D1 — memory estimate.
{
  const empty = estimateMemory("");
  eq(empty.bytes, 0, "empty source costs nothing");

  const short = estimateMemory("var ab = 1;");
  const long = estimateMemory("var abcdefghij = 1;");
  if (!(long.bytes > short.bytes)) {
    fail("longer identifiers must cost more RAM than short ones");
  }

  const logged = estimateMemory('console.log("x");');
  const printed = estimateMemory('print("x");');
  if (!(logged.bytes > printed.bytes)) {
    fail("console.log carries ~42 B of overhead that print does not");
  }
  eq(logged.counted.consoleLog, 1, "console.log counted");
  eq(printed.counted.print, 1, "print counted");

  const smallInt = estimateMemory("var a = 1;");
  const bigInt = estimateMemory("var a = 99999;");
  if (!(bigInt.bytes > smallInt.bytes)) {
    fail("integers over 8191 occupy two JsVar blocks");
  }

  // Strings are byte arrays on device, so a multi-byte character costs more.
  const ascii = estimateMemory('var a = "aaaaaaaaa";');
  const utf8 = estimateMemory('var a = "ááááááááá";');
  if (!(utf8.bytes > ascii.bytes)) {
    fail("string cost must be measured in UTF-8 bytes, not characters");
  }

  const sample = estimateMemoryFile();
  if (!(sample.bytes > 0)) fail("sample script should have a non-zero estimate");
  const parts = Object.values(sample.breakdown).reduce((a, b) => a + b, 0);
  eq(parts, sample.bytes, "breakdown must sum to the total");

  const missing = estimateMemoryFile("/nonexistent/never-written.ts");
  eq(missing.bytes, 0, "missing file estimates zero instead of throwing");
}

// D3 — minimum firmware badge.
{
  eq(minFirmware({}).version, "1.0.0", "baseline with no API use");
  eq(minFirmware({ "Timer.set": 3 }).version, "1.0.0", "core APIs stay on baseline");
  eq(
    minFirmware({ "Script.addRpcHandler": 1 }).version,
    "1.5.0",
    "addRpcHandler needs 1.5.0",
  );
  eq(
    minFirmware({ "Script.storage.setItem": 1 }).version,
    "1.2.0",
    "Script.storage needs 1.2.0",
  );

  const mixed = minFirmware({
    "Timer.set": 1,
    "Script.storage.setItem": 1,
    "Shelly.getUptimeMs": 1,
  });
  eq(mixed.version, "1.5.0", "floor is the highest requirement, not the last seen");
  if (mixed.reasons.length !== 2) {
    fail(`expected 2 reasons above baseline, got ${JSON.stringify(mixed.reasons)}`);
  }
  eq(mixed.reasons[0].version, "1.5.0", "reasons sorted highest first");
  if (mixed.reasons.some((r) => r.api === "Timer.set")) {
    fail("baseline APIs must not be listed as reasons");
  }
}

// D4/D5 — debug log stream and the `#m <series> <value>` convention.
{
  const hit = parseMetric("#m temp 21.5");
  if (!hit) fail("bare metric line not parsed");
  eq(hit.series, "temp", "series name");
  eq(hit.value, 21.5, "series value");

  const prefixed = parseMetric("shelly_script.cpp:123 #m temp 21.5");
  if (!prefixed) fail("device log prefix must not defeat the parser");
  eq(prefixed.series, "temp", "series name behind a prefix");

  for (const bad of ["#m temp", "#m temp abc", "no marker here", ""]) {
    if (parseMetric(bad) !== null) fail(`expected null for ${JSON.stringify(bad)}`);
  }

  // The device may be absent — that must degrade, not throw or hang.
  const started = await startLogStream();
  if (typeof started.connected !== "boolean") fail("startLogStream must report connected");
  if (!started.connected && !started.error) {
    fail("a failed stream must explain itself");
  }
  const read = readLogs(0);
  if (!Array.isArray(read.lines) || !Array.isArray(read.metrics)) {
    fail("readLogs must return line and metric arrays");
  }
  if (typeof read.seq !== "number" || typeof read.dropped !== "number") {
    fail("readLogs must report head seq and dropped count");
  }
  eq(readLogs(read.seq).lines.length, 0, "reading from head yields nothing new");
  stopLogStream();
  stopLogStream();
}

// D6 — chart geometry. The gap rule matters: the device drops log lines, and an
// interpolated segment would invent data that never arrived.
{
  const ascending = [0, 1, 2, 3, 4].map((i) => ({ x: i, y: i * 10 }));
  const [line] = sparkPaths([{ label: "size", points: ascending }]);
  eq((line.match(/M /g) ?? []).length, 1, "continuous data is one subpath");
  eq((line.match(/L /g) ?? []).length, 4, "five points draw four segments");

  const gapped = [
    { x: 0, y: 1 },
    { x: 1, y: null },
    { x: 2, y: 3 },
  ];
  const [broken] = sparkPaths([{ label: "temp", points: gapped }]);
  eq((broken.match(/M /g) ?? []).length, 2, "a null sample breaks the line");

  const [dot] = sparkPaths([{ label: "one", points: [{ x: 5, y: 5 }] }]);
  if (!dot.startsWith("M ")) fail("a single point must still render");
  eq(sparkPaths([]).length, 0, "no series yields no paths");
  eq(sparkPaths([{ label: "empty", points: [] }])[0], undefined, "no live points, no path");
}

// Hover readout: the tooltip must report a real sample, never an interpolation.
{
  const b = { xMin: 0, xMax: 10, yMin: 0, yMax: 100 };
  const series = [
    { label: "tick", points: [{ x: 0, y: 10 }, { x: 5, y: 50 }, { x: 10, y: 90 }] },
  ];
  eq(sampleAt(series, b, 0).readings[0].y, 10, "left edge reads the first sample");
  eq(sampleAt(series, b, 1).readings[0].y, 90, "right edge reads the last sample");
  eq(sampleAt(series, b, 0.44).readings[0].y, 50, "the nearest sample wins, not a midpoint");

  const gapped = [{ label: "g", points: [{ x: 0, y: 1 }, { x: 5, y: null }, { x: 10, y: 3 }] }];
  const readings = sampleAt(gapped, b, 0.5).readings;
  eq(readings.length, 1, "a dropped sample is never reported as a value");
  if (readings[0].y === null) fail("hover must skip null points");

  eq(sampleAt([{ label: "none", points: [] }], b, 0.5), null, "no samples, no tooltip");
}

// Telemetry history is a 5-minute window and nothing longer, by requirement.
{
  const t0 = 1_800_000_000_000;
  const latency = createHistory("test-latency");
  latency.push(20, t0);
  latency.push(24, t0 + 60_000);
  eq(latency.read(t0 + 60_000).length, 2, "samples inside the window are kept");

  // t0 has aged out here; t0+60s has not, so exactly one sample is dropped.
  const afterWindow = latency.push(30, t0 + WINDOW_MS + 1_000);
  const live = afterWindow.filter((p) => p.y !== null);
  eq(live.length, 2, "only samples past the window are dropped on write");
  eq(live[0].y, 24, "the oldest surviving sample is the one still in window");
  eq(live[live.length - 1].y, 30, "the newest sample is appended");
  eq(latency.read(t0 + 3 * WINDOW_MS).length, 0, "an idle window empties itself");

  // Two series must not share a bucket, or RSSI would land in the latency chart.
  const rssi = createHistory("test-rssi");
  rssi.push(-58, t0);
  eq(rssi.read(t0).length, 1, "a second series keeps its own samples");
  eq(latency.read(t0 + 3 * WINDOW_MS).length, 0, "and does not leak into the first");
}

console.log("dashboard: memory estimate / min-firmware / debug-log / spark / latency ok");
