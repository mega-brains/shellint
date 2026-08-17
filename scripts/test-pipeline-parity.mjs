/**
 * M17.1 extraction lock: shared/device-pipeline.mjs's `transformVariant` must
 * reproduce the committed dist/{debug,prod}.{raw.js,js} byte for byte, for
 * the `minify` options currently in devroom.json. This is the parity test
 * the plan promises to guard the scripts/build-shelly.mjs → shared/
 * device-pipeline.mjs move — a silent divergence here would mean the browser
 * build (a later milestone) ships different bytes than the server does.
 *
 * Runs its own tsc pass into a scratch dir (not .tsc-out) so it never
 * clobbers a build running elsewhere, and works standalone without a prior
 * `npm run build:shelly` — though dist/* must already exist to diff against.
 * Usage: node --import tsx scripts/test-pipeline-parity.mjs
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transformVariant } from "../shared/device-pipeline.mjs";
import { DEFAULT_MINIFY, MINIFY_KEYS } from "../shared/minify-options.mjs";
import { deviceGlobalDefs } from "./build-shelly.mjs";
import { distDir, scriptTsconfig } from "./fixture-workspace.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function loadMinifyConfig() {
  const configPath = join(ROOT, "devroom.json");
  if (!existsSync(configPath)) return { ...DEFAULT_MINIFY };
  const raw = JSON.parse(readFileSync(configPath, "utf8"));
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

const DIST = distDir();
const DIST_LABEL = relative(ROOT, DIST) || "dist";

for (const f of ["debug.raw.js", "debug.js", "prod.raw.js", "prod.js"]) {
  if (!existsSync(join(DIST, f))) {
    fail(`missing ${DIST_LABEL}/${f} — run \`npm run build:shelly\` first`);
  }
}

const outDir = mkdtempSync(join(tmpdir(), "devroom-parity-"));
let tscJs;
try {
  const tsc = spawnSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      scriptTsconfig(),
      "--outDir",
      outDir,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (tsc.status !== 0) {
    fail(`tsc failed:\n${tsc.stdout}${tsc.stderr}`);
  }
  tscJs = readFileSync(join(outDir, "main.js"), "utf8");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

const minifyOpts = loadMinifyConfig();
const deviceDefs = minifyOpts.deviceDCE === true ? deviceGlobalDefs() : {};
const sharedIds = new Map();

const debug = await transformVariant(
  tscJs,
  "debug",
  { debug: true, prod: false },
  minifyOpts,
  { sharedIds, shorten: minifyOpts.debugLogMap === true },
  deviceDefs,
);
const prod = await transformVariant(
  tscJs,
  "prod",
  { debug: false, prod: true },
  minifyOpts,
  { sharedIds, shorten: minifyOpts.logMap !== false },
  deviceDefs,
);

const checks = [
  ["debug.raw.js", debug.raw],
  ["debug.js", debug.min],
  ["prod.raw.js", prod.raw],
  ["prod.js", prod.min],
];

for (const [file, produced] of checks) {
  const committed = readFileSync(join(DIST, file), "utf8");
  if (committed !== produced) {
    fail(
      `shared/device-pipeline.mjs output diverges from ${DIST_LABEL}/${file} (committed ${committed.length} B, produced ${produced.length} B)`,
    );
  }
}

console.log(
  "OK: shared/device-pipeline.mjs transformVariant reproduces dist/{debug,prod}.{raw.js,js} byte for byte",
);
