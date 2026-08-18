#!/usr/bin/env node
/**
 * Minify benchmark: build every `bench/*.ts` (plus `scripts/main.ts` as the
 * reference point) under a matrix of `minify.*` option sets and print the byte
 * deltas.
 *
 * Exists because `scripts/main.ts` alone cannot justify a size knob: `passes`,
 * `hoistProps` and `internStrings` all measure ~0 on it, and a knob that
 * measures ~0 on its *one* input has not been measured. See bench/README.md.
 *
 * Usage:
 *   node scripts/bench-minify.mjs                 # all inputs
 *   node scripts/bench-minify.mjs log-heavy       # substring filter on input name
 *   node scripts/bench-minify.mjs --json          # machine-readable
 *
 * Out of scope: tier 3 (`advanced`). It shells out to the espruino CLI, is
 * absent on machines without it, and runs on the Terser output — so it scales
 * whatever tier 2 produces rather than being an independent variable. Also out
 * of scope: `deviceDCE`, which would make results depend on whichever device
 * last wrote types/device-profile.json.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformVariant } from "./build-shelly.mjs";
import { DEFAULT_MINIFY } from "../shared/minify-options.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const BENCH_DIR = path.join(root, "bench");
const TSC_BIN = path.join(root, "node_modules", "typescript", "bin", "tsc");

/**
 * Everything off except the three knobs the shipped default has always had on.
 * Deltas are measured on top of this, not on top of Terser defaults — measuring
 * against Terser defaults would credit `toplevel` (worth −32% on its own) to
 * whichever knob happened to be tested first.
 */
const BASELINE = {
  ...DEFAULT_MINIFY,
  compress: true,
  mangle: true,
  toplevel: true,
  keepFnames: false,
  logMap: true,
  debugLogMap: false,
  advanced: false,
  dropConsole: false,
  passes: false,
  hoistProps: false,
  deviceDCE: false,
  internStrings: false,
};

/**
 * `removal: true` marks a row that turns a *baseline-on* knob off. Its worth is
 * the cost of the row, not its saving — scoring it like the others would report
 * every already-on knob as worthless.
 * @type {{ label: string, opts: Partial<typeof DEFAULT_MINIFY>, removal?: boolean }[]}
 */
const MATRIX = [
  { label: "baseline", opts: {} },
  { label: "−logMap", opts: { logMap: false }, removal: true },
  { label: "+dropConsole", opts: { dropConsole: true } },
  { label: "+passes", opts: { passes: true } },
  { label: "+hoistProps", opts: { hoistProps: true } },
  { label: "+internStrings", opts: { internStrings: true } },
  { label: "+passes+hoistProps", opts: { passes: true, hoistProps: true } },
  {
    label: "all four",
    opts: { dropConsole: true, passes: true, hoistProps: true, internStrings: true },
  },
];

function fail(msg) {
  console.error(`bench: ${msg}`);
  process.exit(1);
}

/** Inputs: every bench/*.ts, then scripts/main.ts as the "what we used to measure on" row. */
function discoverInputs() {
  const out = [];
  if (existsSync(BENCH_DIR)) {
    for (const name of readdirSync(BENCH_DIR).sort()) {
      if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
        out.push({ name: name.replace(/\.ts$/, ""), file: path.join(BENCH_DIR, name), rootDir: "./bench" });
      }
    }
  }
  out.push({ name: "main (reference)", file: path.join(root, "scripts", "main.ts"), rootDir: "./scripts" });
  return out;
}

/**
 * Compile one input through the *device* tsconfig (ES5 / noLib / types: []) so
 * a bench file that drifts out of the Espruino dialect fails here rather than
 * quietly benchmarking code the device could never run.
 * @returns {string} the emitted JS
 */
function compile(input, outDir) {
  const cfgPath = path.join(root, ".bench.tsconfig.json");
  writeFileSync(
    cfgPath,
    JSON.stringify({
      extends: "./tsconfig.shelly.base.json",
      compilerOptions: { rootDir: input.rootDir, outDir: path.relative(root, outDir) },
      include: [path.relative(root, input.file), "types/**/*.d.ts"],
    }),
  );
  try {
    const r = spawnSync(process.execPath, [TSC_BIN, "-p", cfgPath], {
      cwd: root,
      encoding: "utf8",
    });
    if (r.status !== 0) {
      fail(`tsc failed on ${path.relative(root, input.file)}\n${r.stdout || r.stderr}`);
    }
  } finally {
    rmSync(cfgPath, { force: true });
  }
  const emitted = path.join(outDir, `${path.basename(input.file, ".ts")}.js`);
  if (!existsSync(emitted)) fail(`tsc emitted no ${path.relative(root, emitted)}`);
  return readFileSync(emitted, "utf8");
}

const bytes = (s) => Buffer.byteLength(s, "utf8");

/**
 * One option set against one compiled input: both variants, sharing a log-id
 * map exactly as the real build does.
 */
async function measure(tscJs, opts) {
  const sharedIds = new Map();
  const debug = await transformVariant(
    tscJs,
    "debug",
    { debug: true, prod: false },
    opts,
    { sharedIds, shorten: opts.debugLogMap === true },
    {},
  );
  const prod = await transformVariant(
    tscJs,
    "prod",
    { debug: false, prod: true },
    opts,
    { sharedIds, shorten: opts.logMap !== false },
    {},
  );
  return {
    debugRaw: bytes(debug.raw),
    debugMin: bytes(debug.min),
    prodRaw: bytes(prod.raw),
    prodMin: bytes(prod.min),
    interned: prod.interned.interned,
  };
}

function delta(value, base) {
  if (value === base) return "—";
  const d = value - base;
  const pct = ((d / base) * 100).toFixed(1);
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} B / ${d > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

const n = (v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function printTable(input, tscBytes, rows) {
  const base = rows[0].prodMin;
  console.log("");
  console.log(`── ${input.name} — tsc out ${n(tscBytes)} B`);
  const w = Math.max(...MATRIX.map((m) => m.label.length));
  console.log(
    `   ${"option set".padEnd(w)}  ${"prod min".padStart(9)}  ${"Δ vs baseline".padStart(18)}  ${"debug min".padStart(10)}`,
  );
  for (const r of rows) {
    console.log(
      `   ${r.label.padEnd(w)}  ${n(r.prodMin).padStart(9)}  ${delta(r.prodMin, base).padStart(18)}  ${n(r.debugMin).padStart(10)}`,
    );
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const filters = argv.filter((a) => !a.startsWith("--"));

  if (!existsSync(TSC_BIN)) fail("typescript not installed — run npm install");

  const inputs = discoverInputs().filter(
    (i) => filters.length === 0 || filters.some((f) => i.name.includes(f)),
  );
  if (!inputs.length) fail(`no bench input matched ${filters.join(", ")}`);

  const outDir = mkdtempSync(path.join(tmpdir(), "shellint-bench-"));
  const report = [];
  try {
    for (const input of inputs) {
      const tscJs = compile(input, outDir);
      const rows = [];
      for (const cell of MATRIX) {
        const opts = { ...BASELINE, ...cell.opts };
        rows.push({ label: cell.label, ...(await measure(tscJs, opts)) });
      }
      report.push({ input: input.name, tscBytes: bytes(tscJs), rows });
      if (!json) printTable(input, bytes(tscJs), rows);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  if (json) {
    console.log(JSON.stringify({ baseline: BASELINE, report }, null, 2));
    return;
  }

  // Verdict per knob, across every input. The M14b plan's bar is ≥1% on some
  // representative script; a knob under it everywhere is measured-not-worth-it.
  const partial = filters.length > 0;
  console.log("");
  console.log(
    `── best prod-min saving attributable to each knob, across the ${report.length} input(s) above`,
  );
  if (partial) {
    console.log("   (filtered run — a 'retire' verdict here means nothing; run unfiltered)");
  }
  for (const cell of MATRIX.slice(1)) {
    let best = 0;
    let where = "—";
    for (const r of report) {
      const base = r.rows[0].prodMin;
      const row = r.rows.find((x) => x.label === cell.label);
      // A removal row is measured the other way round: the knob is on in the
      // baseline, so what it is worth is how much bigger the output gets
      // without it, as a fraction of that larger output.
      const pct = cell.removal
        ? ((row.prodMin - base) / row.prodMin) * 100
        : ((base - row.prodMin) / base) * 100;
      if (pct > best) {
        best = pct;
        where = r.input;
      }
    }
    const name = cell.removal ? cell.label.replace("−", "") : cell.label;
    const verdict = best >= 1 ? "keep" : partial ? "under 1% here" : "under 1% on every input — retire";
    console.log(`   ${name.padEnd(20)} ${best.toFixed(1).padStart(5)}%  ${where.padEnd(18)} ${verdict}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
