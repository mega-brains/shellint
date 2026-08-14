/**
 * Node-side harness for the M17.3 static/offline device build (no Worker,
 * no browser — driving the same logic modules pipeline.worker.ts imports).
 *
 *  a) Byte-identity: transpileDevice (web/static/transpile.ts) +
 *     transformVariant (shared/device-pipeline.mjs), run over scripts/main.ts
 *     with devroom.json's actual minify config, reproduce the committed
 *     dist/{debug,prod}.{raw.js,js} byte for byte, and dist/prod.logmap.json
 *     where the config shortens logs. This is what actually proves the
 *     worker ships the same bytes `npm run build:shelly` does — the whole
 *     point of extracting shared/device-pipeline.mjs (M17.1) and swapping
 *     the browser path onto transpileModule (M17.2).
 *  b) Bundleability: `esbuild --bundle --platform=browser --format=esm` over
 *     web/static/pipeline.worker.ts succeeds with zero warnings (esbuild's
 *     own static analysis is what actually flags an unresolved or unsafely
 *     dynamic require/import — far more reliable than grepping minified
 *     output), and the bundled text has no unresolved `node:` import
 *     specifier and no bare (non-method, non-string-literal) `require(`
 *     call. `process.` references are checked against an audited allowlist
 *     rather than banned outright: TypeScript's own Node `sys`
 *     implementation (node_modules/typescript/lib/typescript.js,
 *     `isNodeLikeSystem`/`getNodeSystem`) textually contains many
 *     (`process.platform`, `process.exit`, …), but every one sits behind
 *     `isNodeLikeSystem()`'s `typeof process !== "undefined"` guard and is
 *     dead code the instant `process` doesn't exist — the same idiom
 *     Terser's TERSER_DEBUG_DIR hook (node_modules/terser/lib/minify.js)
 *     uses. A *new*, unaudited `process.` property showing up here on a
 *     dependency bump is exactly what this allowlist exists to catch.
 *
 * Usage: node --import tsx scripts/test-static-pipeline.mjs
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import * as esbuild from "esbuild";
import {
  deviceGlobalDefsFrom,
  transformVariant,
} from "../shared/device-pipeline.mjs";
import { DEFAULT_MINIFY, MINIFY_KEYS } from "../shared/minify-options.mjs";
import { transpileDevice } from "../web/static/transpile.ts";
import { staticEsbuildConfig } from "./static-esbuild.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function byteLen(s) {
  return new TextEncoder().encode(s).length;
}

function loadMinifyConfig() {
  const raw = JSON.parse(readFileSync(path.join(ROOT, "devroom.json"), "utf8"));
  const src =
    raw.minify && typeof raw.minify === "object" && !Array.isArray(raw.minify)
      ? raw.minify
      : {};
  const minify = { ...DEFAULT_MINIFY };
  for (const key of MINIFY_KEYS) {
    if (typeof src[key] === "boolean") minify[key] = src[key];
  }
  return minify;
}

/** Same fallback contract as build-shelly.mjs's deviceGlobalDefs: missing/bad file -> {}. */
function loadDeviceProfile() {
  const p = path.join(ROOT, "types", "device-profile.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

async function checkByteIdentity() {
  for (const f of [
    "dist/debug.raw.js",
    "dist/debug.js",
    "dist/prod.raw.js",
    "dist/prod.js",
  ]) {
    if (!existsSync(path.join(ROOT, f))) {
      fail(`missing ${f} — run \`npm run build:shelly\` first`);
    }
  }

  const mainSource = readFileSync(path.join(ROOT, "scripts", "main.ts"), "utf8");
  // "main.ts" — the same fileName shape pipeline.worker.ts hands transpileDevice
  // (a browser has no notion of the repo's on-disk path).
  const tscJs = transpileDevice(mainSource, "main.ts");

  const minifyOpts = loadMinifyConfig();
  const deviceDefs =
    minifyOpts.deviceDCE === true
      ? deviceGlobalDefsFrom(loadDeviceProfile())
      : {};
  const sharedIds = new Map();
  const shortenDebug = minifyOpts.debugLogMap === true;
  const shortenProd = minifyOpts.logMap !== false;

  const debug = await transformVariant(
    tscJs,
    "debug",
    { debug: true, prod: false },
    minifyOpts,
    { sharedIds, shorten: shortenDebug },
    deviceDefs,
  );
  const prod = await transformVariant(
    tscJs,
    "prod",
    { debug: false, prod: true },
    minifyOpts,
    { sharedIds, shorten: shortenProd },
    deviceDefs,
  );

  const checks = [
    ["dist/debug.raw.js", debug.raw],
    ["dist/debug.js", debug.min],
    ["dist/prod.raw.js", prod.raw],
    ["dist/prod.js", prod.min],
  ];
  for (const [file, produced] of checks) {
    const committed = readFileSync(path.join(ROOT, file), "utf8");
    if (committed !== produced) {
      fail(
        `web/static/transpile.ts + shared/device-pipeline.mjs diverge from ${file} ` +
          `(committed ${byteLen(committed)} B, produced ${byteLen(produced)} B)`,
      );
    }
  }

  let logMapChecked = "";
  if (shortenDebug || shortenProd) {
    const map = {};
    for (const [text, id] of sharedIds) map[id] = text;
    const logMapPath = path.join(ROOT, "dist", "prod.logmap.json");
    if (!existsSync(logMapPath)) {
      fail("expected dist/prod.logmap.json — devroom.json's minify config shortens logs");
    }
    const committedMap = JSON.parse(readFileSync(logMapPath, "utf8"));
    assert.deepStrictEqual(map, committedMap, "log map diverges from dist/prod.logmap.json");
    logMapChecked = " + dist/prod.logmap.json";
  }

  console.log(
    `  byte-identity: dist/{debug,prod}.{raw.js,js}${logMapChecked} reproduced via transpileDevice + transformVariant`,
  );
}

/**
 * See the file header for why these — and only these — `process.` property
 * accesses are expected: they're all inside TypeScript's `getNodeSystem()`,
 * reachable only through `isNodeLikeSystem()`'s `typeof process !== "undefined"`
 * guard, or Terser's identically-guarded TERSER_DEBUG_DIR hook (`env`).
 */
const KNOWN_GUARDED_PROCESS_PROPS = new Set([
  "env",
  "nextTick",
  "browser",
  "platform",
  "pid",
  "cwd",
  "argv",
  "stdout",
  "memoryUsage",
  "exit",
  "execArgv",
  "recordreplay",
]);

async function checkBundleability() {
  const outDir = mkdtempSync(path.join(tmpdir(), "devroom-static-pipeline-"));
  try {
    const outfile = path.join(outDir, "pipeline.worker.js");
    // Same config scripts/test-static-check.mjs and (M17.7) build:static use —
    // scripts/static-esbuild.mjs is the one source of truth, so this test
    // exercises exactly what a browser will load, node:*/typescript aliases
    // included.
    const result = await esbuild.build({
      ...staticEsbuildConfig(),
      entryPoints: [path.join(ROOT, "web", "static", "pipeline.worker.ts")],
      outfile,
      minify: true,
      logLevel: "silent",
    });
    if (result.errors.length) {
      fail(`esbuild reported errors:\n${result.errors.map((e) => e.text).join("\n")}`);
    }
    if (result.warnings.length) {
      fail(
        `esbuild reported warnings (usually an unresolved or unsafely-dynamic require/import):\n` +
          result.warnings.map((w) => w.text).join("\n"),
      );
    }

    const bundle = readFileSync(outfile, "utf8");

    if (/\b(?:import\(|require\(|from\s*)["']node:/.test(bundle)) {
      fail("bundle contains an unresolved node: import/require specifier");
    }

    const bareRequires = [...bundle.matchAll(/require\(/g)].filter((m) => {
      const before = bundle[m.index - 1];
      const after = bundle.slice(m.index + 8, m.index + 9);
      if (before === ".") return false; // a method call (e.g. `i.require(...)`), not the global
      if (after === "{" || after === "$") return false; // TS's own diagnostic-message template text
      // server/lint/lint-source.ts's own "no-modules" finding message is the
      // literal text `require() not supported on device` — a string literal,
      // not a call, once server/lint/check.ts entered the bundle (M17.4).
      if (before === '"' || before === "'" || before === "`") return false;
      return true;
    });
    if (bareRequires.length) {
      fail(`bundle contains ${bareRequires.length} bare require( call(s) outside known-safe patterns`);
    }

    const processProps = new Set(
      [...bundle.matchAll(/process\.([A-Za-z_$][A-Za-z0-9_$]*)/g)].map((m) => m[1]),
    );
    const unknown = [...processProps].filter((p) => !KNOWN_GUARDED_PROCESS_PROPS.has(p));
    if (unknown.length) {
      fail(
        `bundle references process.{${unknown.join(", ")}} outside the known-guarded set — ` +
          `verify it's dead code in a browser before adding it to KNOWN_GUARDED_PROCESS_PROPS`,
      );
    }

    const raw = Buffer.byteLength(bundle, "utf8");
    const gz = gzipSync(bundle).length;
    console.log(`  bundleability: pipeline.worker.ts bundles clean, 0 warnings`);
    return { raw, gz };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

await checkByteIdentity();
const { raw, gz } = await checkBundleability();

console.log(
  `OK: static pipeline reproduces dist/* byte for byte; pipeline.worker.ts bundles clean (${raw} B raw / ${gz} B gz)`,
);
