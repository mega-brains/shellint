/**
 * Assert the web UI build stays small.
 *
 * The bundle is this tool's own payload, and it sat at 1.15 MB uncompressed for
 * a while purely because `minify` had never been switched on. These budgets are
 * roughly 10% above the sizes at the time of writing — tighten them whenever a
 * change wins real ground, so the slack cannot be spent silently.
 *
 * Usage: node scripts/test-web-assets.mjs  (expects a prod `npm run build:web`)
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** Every artifact the server expects to be able to serve. */
const REQUIRED = [
  "web/dist/app.js",
  "web/dist/app.js.br",
  "web/dist/app.js.gz",
  "web/dist/styles.css",
  "web/dist/styles.css.br",
  "web/dist/styles.css.gz",
  "web/dist/api-docs.json",
  "web/dist/api-docs.json.br",
];

for (const f of REQUIRED) {
  if (!existsSync(join(ROOT, f))) fail(`missing ${f}`);
}

const BUDGETS = [
  ["web/dist/app.js", 660_000],
  ["web/dist/app.js.br", 190_000],
  // Rebaselined 2026-08-15 (M18): the redesign *removed* CSS — the measure row
  // replaced four bespoke data treatments and the tab strip replaced the
  // accordion machinery, taking 41441 B down to ~35400 B. ~10% above that.
  ["web/dist/styles.css", 39_000],
  ["web/dist/api-docs.json", 40_000],
];

for (const [f, budget] of BUDGETS) {
  const size = statSync(join(ROOT, f)).size;
  if (size > budget) fail(`${f} is ${size} B, over its ${budget} B budget`);
}

// A precompressed sibling that is not actually smaller means the build wrote
// garbage, and the server would serve it in preference to the raw file.
for (const base of ["web/dist/app.js", "web/dist/styles.css"]) {
  const raw = statSync(join(ROOT, base)).size;
  for (const suffix of [".br", ".gz"]) {
    const packed = statSync(join(ROOT, base + suffix)).size;
    if (packed >= raw) {
      fail(`${base}${suffix} (${packed} B) is not smaller than ${base} (${raw} B)`);
    }
  }
}

// Prod builds must not ship the 2.4 MB sourcemap.
if (existsSync(join(ROOT, "web/dist/app.js.map"))) {
  fail("web/dist/app.js.map present in a prod build (sourcemap gating broken?)");
}

// api-docs.json is fetched at runtime; inlining it again would silently undo
// ~28 KB of the bundle saving. Checked on content rather than on a size
// threshold: the bundle has grown on its own since (M18/M21), which made the
// old `size > budget - docs` proxy fire on a bundle that inlines nothing.
// `declare var console:` is api-docs.json's own wording for a hover signature —
// the UI bundle has no other reason to carry it.
if (existsSync(join(ROOT, "web/dist/app.js"))) {
  const bundle = readFileSync(join(ROOT, "web/dist/app.js"), "utf8");
  if (bundle.includes("declare var console:")) {
    fail("app.js looks like it re-inlined api-docs.json");
  }
}

// ---------------------------------------------------------------- site/ (M17.7)
//
// `npm run test` (scripts/test.mjs) never runs `build:static` — only this repo's
// maintainer wires new test modules into that list, and `site/` is a separate,
// optional build. So this section is a bonus assertion when `site/` happens to
// exist (e.g. after a manual `npm run build:static`, or in CI right after it),
// not a hard requirement of a plain `npm run test`.
const siteDir = join(ROOT, "site");
if (existsSync(siteDir)) {
  const SITE_REQUIRED = [
    "index.html",
    "app.js",
    "pipeline.worker.js",
    "styles.css",
    "api-docs.json",
    "sw.js",
    "manifest.webmanifest",
    ".nojekyll",
  ];
  for (const f of SITE_REQUIRED) {
    if (!existsSync(join(siteDir, f))) fail(`site/${f} missing`);
  }

  // No .br/.gz siblings here on purpose — see this file's header on why
  // build-static.mjs skips precompress() for site/ (GitHub Pages gzips itself
  // and won't serve ours).
  for (const suffix of [".br", ".gz"]) {
    for (const base of ["app.js", "styles.css", "pipeline.worker.js"]) {
      if (existsSync(join(siteDir, base + suffix))) {
        fail(`site/${base}${suffix} present — build-static.mjs must not precompress site/`);
      }
    }
  }

  const appBytes = statSync(join(siteDir, "app.js")).size;
  if (appBytes > 700_000) fail(`site/app.js is ${appBytes} B, over its 700000 B budget`);

  const workerPath = join(siteDir, "pipeline.worker.js");
  const workerBytes = statSync(workerPath).size;
  if (workerBytes > 5_000_000) {
    fail(`site/pipeline.worker.js is ${workerBytes} B, over its 5000000 B raw budget`);
  }
  const workerGz = gzipSync(readFileSync(workerPath)).length;
  if (workerGz > 1_350_000) {
    fail(`site/pipeline.worker.js gzips to ${workerGz} B, over its 1350000 B gz budget`);
  }

  // The worker (TypeScript + Terser + tier 3) must stay a separate chunk, not
  // get inlined into the initial app.js — that would both blow the 700 KB
  // budget above (it would land near 4 MB) and defeat the entire point of the
  // worker split (M17 plan §10). "Debug Failure." is one of TypeScript's own
  // internal assertion messages, present in any bundle that pulled in the
  // compiler; it has no reason to appear in the UI bundle otherwise.
  const appSource = readFileSync(join(siteDir, "app.js"), "utf8");
  if (appSource.includes("Debug Failure.")) {
    fail("site/app.js appears to contain the TypeScript compiler — pipeline.worker.ts got inlined instead of split out");
  }

  console.log(
    `OK: site/ present and within budget (app.js ${appBytes} B, worker ${workerBytes} B raw / ${workerGz} B gz)`,
  );
}

console.log("OK: web assets present, precompressed and within budget");
