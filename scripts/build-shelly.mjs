#!/usr/bin/env node
/**
 * Clean-room Shelly script build: tsc (ES5, flat) → meta.env DCE ×2 → optional minify.
 * Emits:
 *   dist/debug.raw.js  dist/debug.js
 *   dist/prod.raw.js   dist/prod.js
 * No IIFE wrapper.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const CONFIG_PATH = path.join(root, "devroom.json");
const TSCONFIG = path.join(root, "tsconfig.shelly.json");
const MAIN_TS = path.join(root, "scripts", "main.ts");
const TSC_OUT_DIR = path.join(root, ".tsc-out");
const TSC_OUT_JS = path.join(TSC_OUT_DIR, "main.js");
const DIST_DIR = path.join(root, "dist");

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return { compiler: "devroom" };
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
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

/** Size minify on already-env-substituted code. */
async function minifyPass(code) {
  const result = await minify(code, {
    compress: true,
    mangle: true,
    format: {
      comments: /@meta/,
    },
  });
  if (!result.code) {
    throw new Error("minify pass produced empty output");
  }
  return result.code;
}

async function buildVariant(tscJs, name, flags) {
  const raw = await envPass(tscJs, flags);
  const min = await minifyPass(raw);
  const rawPath = path.join(DIST_DIR, `${name}.raw.js`);
  const minPath = path.join(DIST_DIR, `${name}.js`);
  writeFileSync(rawPath, raw, "utf8");
  writeFileSync(minPath, min, "utf8");
  return {
    name,
    rawBytes: byteLen(raw),
    minBytes: byteLen(min),
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

  const debug = await buildVariant(tscJs, "debug", {
    debug: true,
    prod: false,
  });
  const prod = await buildVariant(tscJs, "prod", {
    debug: false,
    prod: true,
  });

  console.log(
    JSON.stringify(
      {
        debug: { raw: debug.rawBytes, min: debug.minBytes },
        prod: { raw: prod.rawBytes, min: prod.minBytes },
      },
      null,
      2,
    ),
  );
  console.log(
    `dist/debug.raw.js ${debug.rawBytes} B  dist/debug.js ${debug.minBytes} B`,
  );
  console.log(
    `dist/prod.raw.js  ${prod.rawBytes} B  dist/prod.js  ${prod.minBytes} B`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
