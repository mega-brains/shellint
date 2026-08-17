#!/usr/bin/env node
/**
 * Clean-room Shelly script build: tsc (ES5, flat) → meta.env DCE ×2 → optional minify.
 * Emits:
 *   dist/debug.raw.js  dist/debug.js  dist/debug.adv.js
 *   dist/prod.raw.js   dist/prod.js   dist/prod.adv.js  dist/prod.logmap.json
 * No IIFE wrapper. The tier-3 (`.adv.js`) artifact and the log map are both
 * best-effort: neither absence is a build failure. Log shortening runs on prod
 * when `minify.logMap` (default on) and on debug when `minify.debugLogMap`.
 *
 * The pure transform (envPass, minifyPass, resolveVariantOptions,
 * transformVariant, deviceGlobalDefsFrom) lives in shared/device-pipeline.mjs
 * — zero node builtins, so a browser Web Worker can run the identical bytes
 * (M17). This file wraps it with the tsc spawn, disk IO, and the CLI's
 * console output.
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
import { minifyAdvanced } from "./minify-adv.mjs";
import {
  deviceGlobalDefsFrom,
  envPass,
  minifyPass,
  resolveVariantOptions,
  transformVariant,
} from "../shared/device-pipeline.mjs";
import { DEFAULT_MINIFY, MINIFY_KEYS } from "../shared/minify-options.mjs";

export { envPass, minifyPass, resolveVariantOptions, transformVariant };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const CONFIG_PATH = path.join(root, "devroom.json");
const DEVICE_PROFILE_ENV = "types/device-profile.json";

/** Absolute-or-root-relative env override — see server/core/paths.ts. */
function fromEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return path.isAbsolute(raw) ? raw : path.join(root, raw);
}

// The gate builds the fixture (fixtures/device/main.ts, copied into a scratch
// workspace) instead of the user's live scripts/main.ts, and writes its
// artifacts elsewhere so a test run can never leave dist/ holding bytes the
// next Deploy would ship. See scripts/fixture-workspace.mjs.
const MAIN_TS = fromEnv("DEVROOM_SCRIPT", path.join(root, "scripts", "main.ts"));
const DIST_DIR = fromEnv("DEVROOM_DIST", path.join(root, "dist"));
const IS_DEFAULT_SCRIPT = MAIN_TS === path.join(root, "scripts", "main.ts");
const TSC_OUT_DIR = IS_DEFAULT_SCRIPT
  ? path.join(root, ".tsc-out")
  : path.join(DIST_DIR, ".tsc-out");
const TSC_OUT_JS = path.join(
  TSC_OUT_DIR,
  `${path.basename(MAIN_TS, path.extname(MAIN_TS))}.js`,
);
const TSCONFIG = path.join(root, "tsconfig.shelly.script.json");
const DEVICE_PROFILE_PATH = path.join(root, DEVICE_PROFILE_ENV);

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
  for (const key of MINIFY_KEYS) {
    if (typeof src[key] === "boolean") minify[key] = src[key];
  }
  return { ...raw, minify };
}

function byteLen(s) {
  return Buffer.byteLength(s, "utf8");
}

/**
 * `meta.device.*` global_defs sourced from `types/device-profile.json`, for
 * `minify.deviceDCE`. A missing file, unparseable JSON, or a missing field
 * substitutes *nothing* for that field — feeding `undefined` into
 * `global_defs` would turn a live branch dead and silently delete working
 * code, which is worse than leaving `meta.device.x` un-substituted. Absent or
 * partial coverage prints a build warning and the build continues. Field
 * handling itself (which keys, which warnings) lives in
 * `deviceGlobalDefsFrom` (shared/device-pipeline.mjs); this wrapper only
 * reads and parses the file.
 * @returns {Record<string, unknown>} zero, one, two, or three `meta.device.*` keys
 */
export function deviceGlobalDefs(profilePath = DEVICE_PROFILE_PATH) {
  if (!existsSync(profilePath)) {
    console.error(
      `deviceDCE: ${path.relative(root, profilePath)} is missing (run \`mise run profile\`) — meta.device.* left un-substituted`,
    );
    return {};
  }
  let profile;
  try {
    profile = JSON.parse(readFileSync(profilePath, "utf8"));
  } catch (err) {
    console.error(
      `deviceDCE: ${path.relative(root, profilePath)} is not valid JSON (${err.message}) — meta.device.* left un-substituted`,
    );
    return {};
  }
  return deviceGlobalDefsFrom(profile);
}

/**
 * tsconfig for a script outside scripts/ (the fixture workspace). Generated
 * rather than committed so the entry, its rootDir and the emit dir always
 * agree with DEVROOM_SCRIPT/DEVROOM_DIST; compiler options still come from the
 * one committed base, so fixture and live script compile identically.
 */
function writeGeneratedTsconfig() {
  const file = path.join(TSC_OUT_DIR, "tsconfig.json");
  writeFileSync(
    file,
    JSON.stringify(
      {
        extends: path.join(root, "tsconfig.shelly.base.json"),
        compilerOptions: { rootDir: path.dirname(MAIN_TS), outDir: TSC_OUT_DIR },
        include: [MAIN_TS, path.join(root, "types", "*.d.ts")],
        exclude: [path.join(root, "types", "generated.d.ts")],
      },
      null,
      2,
    ),
    "utf8",
  );
  return file;
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
 * @param {typeof DEFAULT_MINIFY} minifyOpts raw config, not yet scope-resolved
 * @param {{ sharedIds: Map<string, string>, shorten: boolean }} logMapState
 * @param {Record<string, unknown>} deviceDefs meta.device.* global_defs (possibly {})
 */
async function buildVariant(tscJs, name, flags, minifyOpts, logMapState, deviceDefs) {
  const { variantOpts, raw, min, interned } = await transformVariant(
    tscJs,
    name,
    flags,
    minifyOpts,
    logMapState,
    deviceDefs,
  );
  const rawPath = path.join(DIST_DIR, `${name}.raw.js`);
  const minPath = path.join(DIST_DIR, `${name}.js`);
  const advPath = path.join(DIST_DIR, `${name}.adv.js`);
  writeFileSync(rawPath, raw, "utf8");
  writeFileSync(minPath, min, "utf8");

  // Tier 3 runs on the Terser output rather than the raw source: on its own it
  // can come out larger than tier 2, chained it never does.
  rmSync(advPath, { force: true });
  let adv = { ok: false, reason: "disabled in config" };
  if (variantOpts.advanced !== false) {
    adv = await minifyAdvanced(min);
    if (adv.ok) writeFileSync(advPath, adv.code, "utf8");
  }

  return {
    name,
    rawBytes: byteLen(raw),
    minBytes: byteLen(min),
    advBytes: adv.ok ? byteLen(adv.code) : undefined,
    advSkipped: adv.ok ? undefined : adv.reason,
    interned: interned.interned,
    internedBytes: interned.savedBytes,
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

  const tsconfigPath = IS_DEFAULT_SCRIPT ? TSCONFIG : writeGeneratedTsconfig();

  const tsc = spawnSync(
    process.execPath,
    [
      tscBin,
      "-p",
      tsconfigPath,
      ...(process.argv.includes("--no-typecheck") ? ["--noCheck"] : []),
    ],
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
  // Computed once (not per variant): meta.device.* is scope "both", so debug
  // and prod get identical substitutions. {} is the exact no-op when
  // deviceDCE is off — no profile read happens at all.
  const deviceDefs =
    minifyOpts.deviceDCE === true ? deviceGlobalDefs() : {};

  const debug = await buildVariant(
    tscJs,
    "debug",
    { debug: true, prod: false },
    minifyOpts,
    { sharedIds, shorten: shortenDebug },
    deviceDefs,
  );
  const prod = await buildVariant(
    tscJs,
    "prod",
    { debug: false, prod: true },
    minifyOpts,
    { sharedIds, shorten: shortenProd },
    deviceDefs,
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
  const d = path.relative(root, DIST_DIR) || "dist";
  const advText = (v) =>
    v.advBytes != null
      ? `${d}/${v.name}.adv.js ${v.advBytes} B`
      : `tier 3 skipped (${v.advSkipped})`;
  console.log(
    `${d}/debug.raw.js ${debug.rawBytes} B  ${d}/debug.js ${debug.minBytes} B  ${advText(debug)}`,
  );
  console.log(
    `${d}/prod.raw.js  ${prod.rawBytes} B  ${d}/prod.js  ${prod.minBytes} B  ${advText(prod)}`,
  );

  if (minifyOpts.internStrings === true) {
    console.log(
      `internStrings: debug ${debug.interned} string(s) interned (${debug.internedBytes} B saved), prod ${prod.interned} string(s) interned (${prod.internedBytes} B saved)`,
    );
  }

  if (minifyOpts.deviceDCE === true) {
    const fields = Object.keys(deviceDefs).map((k) => k.split(".")[2]);
    console.log(
      fields.length
        ? `deviceDCE: substituted meta.device.{${fields.join(", ")}} from ${path.relative(root, DEVICE_PROFILE_PATH)} — these artifacts are device-specific (see warnings above for any field left un-substituted)`
        : `deviceDCE: on, but no meta.device.* field was substituted (see warning above) — artifacts are the same as deviceDCE off`,
    );
  }
}

// Guarded so tests can `import` the pure functions above (envPass, minifyPass,
// resolveVariantOptions, deviceGlobalDefs) without triggering a real build
// against the live devroom.json as a side effect of the import.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
