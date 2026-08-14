/**
 * Asserts `site/` (scripts/build-static.mjs, M17.7) is what GitHub Pages
 * needs: every required file, within budget, no leaked Node-only reference,
 * and an index.html that never hardcodes a root-relative asset path (which
 * would 404 under Pages' `/<repo>/` subpath — M17 plan §6).
 *
 * Requires a fresh `npm run build:static` first — this does not build it
 * itself, the same precondition scripts/test-static-pipeline.mjs has for
 * `npm run build:shelly`.
 *
 * Usage: node --import tsx scripts/test-static-bundle.mjs
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "site");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(SITE)) fail("site/ missing — run `npm run build:static` first");

// ------------------------------------------------------------- required files

const REQUIRED = [
  "index.html",
  "app.js",
  "pipeline.worker.js",
  "styles.css",
  "api-docs.json",
  "sw.js",
  "manifest.webmanifest",
  ".nojekyll",
];
for (const f of REQUIRED) {
  if (!existsSync(join(SITE, f))) fail(`site/${f} missing`);
}

// No precompressed siblings — GitHub Pages does its own gzip and will not
// serve a `.br` file for a request to the plain name (M17 plan §6).
for (const base of ["app.js", "styles.css", "pipeline.worker.js"]) {
  for (const suffix of [".br", ".gz"]) {
    if (existsSync(join(SITE, base + suffix))) {
      fail(`site/${base}${suffix} present — build-static.mjs must not precompress site/`);
    }
  }
}

console.log("  required files: present, no precompressed siblings");

// ------------------------------------------------------------------ budgets

const appBytes = statSync(join(SITE, "app.js")).size;
if (appBytes > 700_000) fail(`site/app.js is ${appBytes} B, over its 700000 B budget`);

const workerPath = join(SITE, "pipeline.worker.js");
const workerBytes = statSync(workerPath).size;
if (workerBytes > 5_000_000) {
  fail(`site/pipeline.worker.js is ${workerBytes} B, over its 5000000 B raw budget`);
}
const workerGz = gzipSync(readFileSync(workerPath)).length;
if (workerGz > 1_350_000) {
  fail(`site/pipeline.worker.js gzips to ${workerGz} B, over its 1350000 B gz budget`);
}

const appSource = readFileSync(join(SITE, "app.js"), "utf8");
// "Debug Failure." is one of TypeScript's own internal assertion messages —
// present in any bundle that pulled in the compiler. It has no legitimate
// reason to appear in the UI chunk; if it does, pipeline.worker.ts got
// inlined into app.js instead of staying a separate lazily-loaded chunk,
// which would also blow the budget above (~4 MB instead of ~630 KB).
if (appSource.includes("Debug Failure.")) {
  fail("site/app.js appears to contain the TypeScript compiler — the worker got inlined");
}

console.log(
  `  budgets: app.js ${appBytes} B (≤700000), worker ${workerBytes} B raw / ${workerGz} B gz (≤5000000 / ≤1350000), worker not inlined`,
);

// ------------------------------------------------------------------ leakage
//
// Mirrors scripts/test-static-pipeline.mjs's bundleability checks, applied to
// the actual shipped files rather than a throwaway esbuild run — this is what
// a browser on GitHub Pages actually receives. staticAppEsbuildConfig() (app.js)
// carries none of the node-shim aliases staticEsbuildConfig() (the worker)
// does, so app.js should be completely clean; the worker is expected to
// reference the allowlisted, provably-dead-code `process.*` accesses inside
// TypeScript's/Terser's own `typeof process !== "undefined"` guards.
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

function checkLeakage(name, bundle) {
  if (/\b(?:import\(|require\(|from\s*)["']node:/.test(bundle)) {
    fail(`site/${name} contains an unresolved node: import/require specifier`);
  }

  const bareRequires = [...bundle.matchAll(/require\(/g)].filter((m) => {
    const before = bundle[m.index - 1];
    const after = bundle.slice(m.index + 8, m.index + 9);
    if (before === ".") return false; // a method call, not the global
    if (after === "{" || after === "$") return false; // TS's own diagnostic-message template text
    if (before === '"' || before === "'" || before === "`") return false; // a string literal, not a call
    return true;
  });
  if (bareRequires.length) {
    fail(`site/${name} contains ${bareRequires.length} bare require( call(s) outside known-safe patterns`);
  }

  const processProps = new Set([...bundle.matchAll(/process\.([A-Za-z_$][A-Za-z0-9_$]*)/g)].map((m) => m[1]));
  const unknown = [...processProps].filter((p) => !KNOWN_GUARDED_PROCESS_PROPS.has(p));
  if (unknown.length) {
    fail(`site/${name} references process.{${unknown.join(", ")}} outside the known-guarded set`);
  }
}

checkLeakage("app.js", appSource);
checkLeakage("pipeline.worker.js", readFileSync(workerPath, "utf8"));

console.log("  leakage: no node:/bare require(/unguarded process. reference in app.js or pipeline.worker.js");

// ------------------------------------------------------------- index.html

const html = readFileSync(join(SITE, "index.html"), "utf8");
// A root-relative reference (leading "/", not "./" or "//host/…") would
// resolve to the Pages user/org root instead of "/<repo>/" and 404.
const absoluteRefs = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]);
if (absoluteRefs.length) {
  fail(`site/index.html has root-relative asset reference(s): ${absoluteRefs.join(", ")}`);
}
for (const name of ["app.js", "styles.css", "sw.js", "manifest.webmanifest"]) {
  if (!html.includes(`"./${name}"`)) fail(`site/index.html has no relative reference to ./${name}`);
}

console.log("  index.html: relative asset paths only");

console.log("OK: site/ present, within budget, leak-free, and Pages-subpath-safe");
