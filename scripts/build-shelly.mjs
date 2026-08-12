#!/usr/bin/env node
/**
 * Clean-room Shelly script build: tsc (ES5, flat) → meta.env DCE ×2 → optional minify.
 * Emits:
 *   dist/debug.raw.js  dist/debug.js  dist/debug.adv.js
 *   dist/prod.raw.js   dist/prod.js   dist/prod.adv.js  dist/prod.logmap.json
 * No IIFE wrapper. The tier-3 (`.adv.js`) artifact and the log map are both
 * best-effort: neither absence is a build failure. Log shortening runs on prod
 * when `minify.logMap` (default on) and on debug when `minify.debugLogMap`.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";
import { minifyAdvanced } from "./minify-adv.mjs";
import { shortenLogStrings } from "./log-shorten.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const CONFIG_PATH = path.join(root, "devroom.json");
const TSCONFIG = path.join(root, "tsconfig.shelly.json");
const MAIN_TS = path.join(root, "scripts", "main.ts");
const TSC_OUT_DIR = path.join(root, ".tsc-out");
const TSC_OUT_JS = path.join(TSC_OUT_DIR, "main.js");
const DIST_DIR = path.join(root, "dist");

/** Defaults match today's pipeline when `minify` is absent from devroom.json. */
const DEFAULT_MINIFY = {
  compress: true,
  mangle: true,
  toplevel: false,
  keepFnames: false,
  logMap: true,
  /** Opt-in: also shorten log strings on the debug artifact. */
  debugLogMap: false,
  advanced: true,
};

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return { compiler: "devroom", minify: { ...DEFAULT_MINIFY } };
  }
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const src =
    raw.minify && typeof raw.minify === "object" && !Array.isArray(raw.minify)
      ? raw.minify
      : {};
  const minify = { ...DEFAULT_MINIFY };
  for (const key of Object.keys(DEFAULT_MINIFY)) {
    if (typeof src[key] === "boolean") minify[key] = src[key];
  }
  return { ...raw, minify };
}

function byteLen(s) {
  return Buffer.byteLength(s, "utf8");
}

/** Apply meta.env literals + DCE only — readable, no mangle. */
async function envPass(code, { debug, prod }) {
  const result = await minify(code, {
    compress: {
      defaults: false,
      dead_code: true,
      conditionals: true,
      evaluate: true,
      booleans: true,
      if_return: true,
      join_vars: false,
      sequences: false,
      global_defs: {
        "meta.env.debug": debug,
        "meta.env.prod": prod,
      },
    },
    mangle: false,
    format: {
      beautify: true,
      comments: /@meta/,
    },
  });
  if (!result.code) {
    throw new Error("env pass produced empty output");
  }
  return result.code;
}

/**
 * Size minify on already-env-substituted code.
 * Options mirror `devroom.json` `minify.*` Terser knobs.
 */
async function minifyPass(code, opts) {
  const compress = opts.compress !== false;
  const mangle = opts.mangle !== false;
  const toplevel = !!opts.toplevel;
  const keepFnames = !!opts.keepFnames;

  let compressOpt = false;
  if (compress) {
    if (toplevel || keepFnames) {
      compressOpt = {};
      if (toplevel) compressOpt.toplevel = true;
      if (keepFnames) compressOpt.keep_fnames = true;
    } else {
      compressOpt = true;
    }
  }

  let mangleOpt = false;
  if (mangle) {
    if (toplevel || keepFnames) {
      mangleOpt = {};
      if (toplevel) mangleOpt.toplevel = true;
      if (keepFnames) mangleOpt.keep_fnames = true;
    } else {
      mangleOpt = true;
    }
  }

  const result = await minify(code, {
    compress: compressOpt,
    mangle: mangleOpt,
    format: {
      comments: /@meta/,
    },
  });
  if (!result.code) {
    throw new Error("minify pass produced empty output");
  }
  return result.code;
}

/** Rewritten so a map from an earlier build can never outlive the strings it describes. */
function writeLogMap(map) {
  const mapPath = path.join(DIST_DIR, "prod.logmap.json");
  if (Object.keys(map).length === 0) {
    rmSync(mapPath, { force: true });
    return;
  }
  writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

/**
 * @param {string} tscJs
 * @param {string} name
 * @param {{ debug: boolean, prod: boolean }} flags
 * @param {typeof DEFAULT_MINIFY} minifyOpts
 * @param {{ sharedIds: Map<string, string>, shorten: boolean }} logMapState
 */
async function buildVariant(tscJs, name, flags, minifyOpts, logMapState) {
  let raw = await envPass(tscJs, flags);
  // Log strings cost RAM on device; the log panel re-expands the ids.
  if (logMapState.shorten) {
    const shortened = shortenLogStrings(raw, logMapState.sharedIds);
    raw = shortened.code;
  }

  const min = await minifyPass(raw, minifyOpts);
  const rawPath = path.join(DIST_DIR, `${name}.raw.js`);
  const minPath = path.join(DIST_DIR, `${name}.js`);
  const advPath = path.join(DIST_DIR, `${name}.adv.js`);
  writeFileSync(rawPath, raw, "utf8");
  writeFileSync(minPath, min, "utf8");

  // Tier 3 runs on the Terser output rather than the raw source: on its own it
  // can come out larger than tier 2, chained it never does.
  rmSync(advPath, { force: true });
  let adv = { ok: false, reason: "disabled in config" };
  if (minifyOpts.advanced !== false) {
    adv = await minifyAdvanced(min);
    if (adv.ok) writeFileSync(advPath, adv.code, "utf8");
  }

  return {
    name,
    rawBytes: byteLen(raw),
    minBytes: byteLen(min),
    advBytes: adv.ok ? byteLen(adv.code) : undefined,
    advSkipped: adv.ok ? undefined : adv.reason,
  };
}

async function main() {
  const config = loadConfig();
  const compiler = config.compiler ?? "devroom";

  if (compiler !== "devroom") {
    console.error("shelly-forge path not wired yet");
    process.exit(1);
  }

  if (!existsSync(MAIN_TS)) {
    console.error(`Missing ${path.relative(root, MAIN_TS)}`);
    process.exit(1);
  }

  const tscBin = path.join(root, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tscBin)) {
    console.error("typescript not installed — run npm install");
    process.exit(1);
  }

  rmSync(TSC_OUT_DIR, { recursive: true, force: true });
  mkdirSync(TSC_OUT_DIR, { recursive: true });

  const tsc = spawnSync(
    process.execPath,
    [tscBin, "-p", TSCONFIG],
    { cwd: root, encoding: "utf8" },
  );
  if (tsc.status !== 0) {
    if (tsc.stdout) process.stderr.write(tsc.stdout);
    if (tsc.stderr) process.stderr.write(tsc.stderr);
    console.error("tsc failed");
    process.exit(tsc.status ?? 1);
  }

  if (!existsSync(TSC_OUT_JS)) {
    console.error(`tsc did not emit ${path.relative(root, TSC_OUT_JS)}`);
    process.exit(1);
  }

  const tscJs = readFileSync(TSC_OUT_JS, "utf8");
  mkdirSync(DIST_DIR, { recursive: true });
  const minifyOpts = config.minify ?? DEFAULT_MINIFY;

  const shortenDebug = minifyOpts.debugLogMap === true;
  const shortenProd = minifyOpts.logMap !== false;
  /** Shared across variants so one dist/prod.logmap.json covers both. */
  const sharedIds = new Map();

  const debug = await buildVariant(
    tscJs,
    "debug",
    { debug: true, prod: false },
    minifyOpts,
    { sharedIds, shorten: shortenDebug },
  );
  const prod = await buildVariant(
    tscJs,
    "prod",
    { debug: false, prod: true },
    minifyOpts,
    { sharedIds, shorten: shortenProd },
  );

  if (shortenDebug || shortenProd) {
    /** @type {Record<string, string>} */
    const map = {};
    for (const [text, id] of sharedIds) map[id] = text;
    writeLogMap(map);
  } else {
    writeLogMap({});
  }

  const sizes = (v) => {
    const out = { raw: v.rawBytes, min: v.minBytes };
    if (v.advBytes != null) out.adv = v.advBytes;
    return out;
  };
  console.log(
    JSON.stringify({ debug: sizes(debug), prod: sizes(prod) }, null, 2),
  );
  const advText = (v) =>
    v.advBytes != null
      ? `dist/${v.name}.adv.js ${v.advBytes} B`
      : `tier 3 skipped (${v.advSkipped})`;
  console.log(
    `dist/debug.raw.js ${debug.rawBytes} B  dist/debug.js ${debug.minBytes} B  ${advText(debug)}`,
  );
  console.log(
    `dist/prod.raw.js  ${prod.rawBytes} B  dist/prod.js  ${prod.minBytes} B  ${advText(prod)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
