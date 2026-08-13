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
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  ["web/dist/styles.css", 40_500],
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
// ~21 KB of the bundle saving.
if (existsSync(join(ROOT, "web/dist/app.js"))) {
  const bundle = statSync(join(ROOT, "web/dist/app.js")).size;
  const docs = statSync(join(ROOT, "web/dist/api-docs.json")).size;
  if (bundle > 660_000 - docs) {
    fail("app.js looks like it re-inlined api-docs.json");
  }
}

console.log("OK: web assets present, precompressed and within budget");
