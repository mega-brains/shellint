/**
 * Locks the POC finding behind M17.2: `ts.transpileModule` run with
 * `config/tsconfig.shelly.base.json`'s compiler options must emit byte-identical output
 * to `tsc -p config/tsconfig.shelly.base.json`. The future browser build swaps the `tsc`
 * child-process spawn for an in-process `transpileModule` call, so a
 * TypeScript upgrade must never silently break that.
 * Also asserts web/static/transpile.ts's `DEVICE_COMPILER_OPTIONS` — the
 * inlined duplicate a Worker needs because it cannot read config/tsconfig.shelly.base.json
 * off disk (M17.3) — stays equivalent to what config/tsconfig.shelly.base.json itself
 * parses to, so a future tsconfig edit can't silently drift the browser build
 * away from the server build.
 * Usage: node --import tsx scripts/test-transpile-parity.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { DEVICE_COMPILER_OPTIONS } from "../web/static/transpile.ts";

const root = path.resolve(import.meta.dirname, "..");
const TSC_BIN = path.join(root, "node_modules", "typescript", "bin", "tsc");
const CONFIG_PATH = path.join(root, "config", "tsconfig.shelly.base.json");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function diffHint(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ctx = (s) => JSON.stringify(s.slice(Math.max(0, i - 20), i + 20));
  return `first difference at byte ${i} (lengths ${a.length} vs ${b.length})\n  tsc:     ${ctx(a)}\n  transpileModule: ${ctx(b)}`;
}

// Single source of truth for the device compiler options: read + resolve
// config/tsconfig.shelly.base.json itself rather than a hand-copied duplicate, so a
// future edit to that file is picked up here automatically.
const configFile = ts.readConfigFile(CONFIG_PATH, ts.sys.readFile);
if (configFile.error) fail(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
// The base config carries compiler options only (`include: []`), which would
// make parseJsonConfigFileContent report "no inputs" — the fixture stands in
// as the entry so the options resolve exactly as they do in a real build.
const parsed = ts.parseJsonConfigFileContent(
  { ...configFile.config, include: ["fixtures/device/main.ts", "types/**/*.d.ts"] },
  ts.sys,
  root,
);
if (parsed.errors.length) {
  fail(parsed.errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n")).join("\n"));
}

// rootDir/outDir/configFilePath steer where a Program reads/writes on disk;
// transpileModule has no Program and never touches disk, so they are inert
// (but harmless) — dropped here to keep the options object honest.
const { rootDir: _rootDir, outDir: _outDir, configFilePath: _cfp, ...transpileOptions } =
  parsed.options;

/** Compile one source file through the real `tsc -p`, into our own tmp dir. */
function tscReferenceOutput(sourceFileAbs, rootDirAbs, outDirAbs) {
  const cfgPath = path.join(outDirAbs, `tsconfig.${path.basename(sourceFileAbs, ".ts")}.json`);
  writeFileSync(
    cfgPath,
    JSON.stringify({
      compilerOptions: { ...configFile.config.compilerOptions, rootDir: rootDirAbs, outDir: outDirAbs },
      include: [sourceFileAbs, path.join(root, "types", "**", "*.d.ts")],
      exclude: (configFile.config.exclude ?? []).map((p) => path.join(root, p)),
    }),
  );
  const r = spawnSync(process.execPath, [TSC_BIN, "-p", cfgPath], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) fail(`tsc failed on ${sourceFileAbs}\n${r.stdout || r.stderr}`);
  const emitted = path.join(outDirAbs, `${path.basename(sourceFileAbs, ".ts")}.js`);
  return readFileSync(emitted, "utf8");
}

function assertParity(name, sourceFileAbs, rootDirAbs, outDirAbs, options) {
  const source = readFileSync(sourceFileAbs, "utf8");
  const tscOutput = tscReferenceOutput(sourceFileAbs, rootDirAbs, outDirAbs);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: options,
    fileName: sourceFileAbs,
  }).outputText;
  if (transpiled !== tscOutput) {
    fail(`transpileModule diverged from tsc -p for ${name}\n${diffHint(tscOutput, transpiled)}`);
  }
  console.log(`  ${name}: ${Buffer.byteLength(tscOutput, "utf8")} B, byte-identical`);
}

const outDir = mkdtempSync(path.join(tmpdir(), "shellint-transpile-parity-"));
try {
  assertParity(
    "fixtures/device/main.ts",
    path.join(root, "fixtures", "device", "main.ts"),
    path.join(root, "fixtures", "device"),
    outDir,
    transpileOptions,
  );
  // A second, unrelated corpus file so the guarantee isn't accidentally
  // specific to the fixture's particular mix of syntax — config-heavy.ts is the
  // bench file with the widest keyword spread (if/for/let/switch/new/typeof).
  assertParity(
    "bench/config-heavy.ts",
    path.join(root, "bench", "config-heavy.ts"),
    path.join(root, "bench"),
    outDir,
    transpileOptions,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

try {
  assert.deepStrictEqual(DEVICE_COMPILER_OPTIONS, transpileOptions);
} catch (err) {
  fail(
    `web/static/transpile.ts's DEVICE_COMPILER_OPTIONS diverged from config/tsconfig.shelly.base.json's parsed compilerOptions:\n${err.message}`,
  );
}
console.log(
  "  web/static/transpile.ts's DEVICE_COMPILER_OPTIONS matches config/tsconfig.shelly.base.json",
);

console.log("OK: ts.transpileModule(config/tsconfig.shelly.base.json options) is byte-identical to tsc -p");
