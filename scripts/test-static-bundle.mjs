/**
 * Asserts `site/` (scripts/build-static.mjs, M26) is what GitHub Pages
 * needs: every required file in the landing/demo/download layout, within
 * budget, no leaked Node-only reference, no leaked editor/compiler weight in
 * the landing bundle, and HTML that never hardcodes a root-relative asset
 * path (which would 404 under Pages' `/<repo>/` subpath — M17 plan §6, still
 * true post-M26).
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
// Shared with scripts/test-web-assets.mjs, which asserts the same two numbers.
import { SITE_CSS_BUDGET, SITE_JS_BUDGET } from "./site-budgets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "site");
const DEMO = join(SITE, "demo");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(SITE)) fail("site/ missing — run `npm run build:static` first");

// ------------------------------------------------------------- required files

const REQUIRED_ROOT = [
  "index.html",
  "download.html",
  "docs.html",
  "checks.html",
  "probe.html",
  "site.js",
  "site.css",
  ".nojekyll",
];
for (const f of REQUIRED_ROOT) {
  if (!existsSync(join(SITE, f))) fail(`site/${f} missing`);
}

const REQUIRED_DEMO = [
  "index.html",
  "app.js",
  "pipeline.worker.js",
  "styles.css",
  "api-docs.json",
  "sw.js",
  "manifest.webmanifest",
];
for (const f of REQUIRED_DEMO) {
  if (!existsSync(join(DEMO, f))) fail(`site/demo/${f} missing`);
}

console.log("  required files: present");

// No precompressed siblings — GitHub Pages does its own gzip and will not
// serve a `.br` file for a request to the plain name (M17 plan §6).
for (const base of ["site.js", "site.css"]) {
  for (const suffix of [".br", ".gz"]) {
    if (existsSync(join(SITE, base + suffix))) {
      fail(`site/${base}${suffix} present — build-static.mjs must not precompress site/`);
    }
  }
}
for (const base of ["app.js", "styles.css", "pipeline.worker.js"]) {
  for (const suffix of [".br", ".gz"]) {
    if (existsSync(join(DEMO, base + suffix))) {
      fail(`site/demo/${base}${suffix} present — build-static.mjs must not precompress site/`);
    }
  }
}

console.log("  no precompressed siblings");

// ------------------------------------------------------------------ budgets

const appBytes = statSync(join(DEMO, "app.js")).size;
if (appBytes > 700_000) fail(`site/demo/app.js is ${appBytes} B, over its 700000 B budget`);

const workerPath = join(DEMO, "pipeline.worker.js");
const workerBytes = statSync(workerPath).size;
if (workerBytes > 5_000_000) {
  fail(`site/demo/pipeline.worker.js is ${workerBytes} B, over its 5000000 B raw budget`);
}
const workerGz = gzipSync(readFileSync(workerPath)).length;
if (workerGz > 1_350_000) {
  fail(`site/demo/pipeline.worker.js gzips to ${workerGz} B, over its 1350000 B gz budget`);
}

const siteJsPath = join(SITE, "site.js");
const siteJsBytes = statSync(siteJsPath).size;
if (siteJsBytes > SITE_JS_BUDGET) {
  fail(`site/site.js is ${siteJsBytes} B, over its ${SITE_JS_BUDGET} B budget`);
}

const siteCssPath = join(SITE, "site.css");
const siteCssBytes = statSync(siteCssPath).size;
if (siteCssBytes > SITE_CSS_BUDGET) {
  fail(`site/site.css is ${siteCssBytes} B, over its ${SITE_CSS_BUDGET} B budget`);
}

const appSource = readFileSync(join(DEMO, "app.js"), "utf8");
const siteJsSource = readFileSync(siteJsPath, "utf8");

// "Debug Failure." is one of TypeScript's own internal assertion messages —
// present in any bundle that pulled in the compiler. It has no legitimate
// reason to appear in the UI chunk (demo/app.js) or the landing/download
// chunk (site.js); if it does in the former, pipeline.worker.ts got inlined
// instead of staying a separate lazily-loaded chunk (also blowing the budget
// above, ~4 MB instead of ~630 KB); if it does in the latter, the landing
// page pulled in the demo app somehow, which it must never do (M26 plan §7.2).
if (appSource.includes("Debug Failure.")) {
  fail("site/demo/app.js appears to contain the TypeScript compiler — the worker got inlined");
}
if (siteJsSource.includes("Debug Failure.")) {
  fail("site/site.js appears to contain the TypeScript compiler — it must not pull in the demo app");
}

// "cm-content" is CodeMirror's own content-editable class name (confirmed
// present in demo/app.js, which does bundle the editor) — a stable marker
// that the landing/download bundle, which has no editor, stayed that way.
if (!appSource.includes("cm-content")) {
  fail('site/demo/app.js does not contain "cm-content" — CodeMirror marker string is no longer stable, update the guard below');
}
if (siteJsSource.includes("cm-content")) {
  fail("site/site.js appears to contain CodeMirror — the landing page must stay small and editor-free");
}

console.log(
  `  budgets: app.js ${appBytes} B (≤700000), worker ${workerBytes} B raw / ${workerGz} B gz (≤5000000 / ≤1350000), ` +
    `site.js ${siteJsBytes} B (≤${SITE_JS_BUDGET}), site.css ${siteCssBytes} B (≤${SITE_CSS_BUDGET}), ` +
    `worker/compiler/editor not leaked into site.js`,
);

// ------------------------------------------------------------------ leakage
//
// Mirrors scripts/test-static-pipeline.mjs's bundleability checks, applied to
// the actual shipped files rather than a throwaway esbuild run — this is what
// a browser on GitHub Pages actually receives. staticAppEsbuildConfig() (used
// for both demo/app.js and site.js) carries none of the node-shim aliases
// staticEsbuildConfig() (the worker) does, so both should be completely
// clean; the worker is expected to reference the allowlisted, provably-dead
// -code `process.*` accesses inside TypeScript's/Terser's own
// `typeof process !== "undefined"` guards.
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

/**
 * `process.*` that is *device* source text, not a Node access: the probe
 * catalog's expressions are strings sent to Espruino, which has its own
 * `process` object, and site.js bundles that catalog for web/site/probe.tsx.
 * Kept separate from the set above so the two reasons stay distinguishable —
 * these are not "guarded by a typeof check", they are data.
 */
const PROBE_DATA_PROCESS_PROPS = new Set(["memory"]);

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
  const unknown = [...processProps].filter(
    (p) => !KNOWN_GUARDED_PROCESS_PROPS.has(p) && !PROBE_DATA_PROCESS_PROPS.has(p),
  );
  if (unknown.length) {
    fail(`site/${name} references process.{${unknown.join(", ")}} outside the known-guarded set`);
  }
}

checkLeakage("demo/app.js", appSource);
checkLeakage("demo/pipeline.worker.js", readFileSync(workerPath, "utf8"));
checkLeakage("site.js", siteJsSource);

console.log("  leakage: no node:/bare require(/unguarded process. reference in demo/app.js, demo/pipeline.worker.js or site.js");

// ------------------------------------------------------------------- html

// A root-relative reference (leading "/", not "./" or "//host/…") would
// resolve to the Pages user/org root instead of "/<repo>/" and 404. Checked
// over every shipped HTML file — the landing/download/docs/checks shells as
// well as the demo, which used to be the only page.
for (const [label, path] of [
  ["index.html", join(SITE, "index.html")],
  ["download.html", join(SITE, "download.html")],
  ["docs.html", join(SITE, "docs.html")],
  ["checks.html", join(SITE, "checks.html")],
  ["probe.html", join(SITE, "probe.html")],
  ["demo/index.html", join(DEMO, "index.html")],
]) {
  const html = readFileSync(path, "utf8");
  const absoluteRefs = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]);
  if (absoluteRefs.length) {
    fail(`site/${label} has root-relative asset reference(s): ${absoluteRefs.join(", ")}`);
  }
}

const demoHtml = readFileSync(join(DEMO, "index.html"), "utf8");
for (const name of ["app.js", "styles.css", "sw.js", "manifest.webmanifest"]) {
  if (!demoHtml.includes(`"./${name}"`)) fail(`site/demo/index.html has no relative reference to ./${name}`);
}

console.log(
  "  html: relative asset paths only across index.html, download.html, docs.html, checks.html, probe.html and demo/index.html",
);

// Cross-page navigation contract (M26 plan §4): the landing must link into
// the demo and the download page; the demo must link back out to the landing.
//
// All three pages render their chrome from Preact, so the hrefs live in the
// *bundles*, not in the HTML shells (which are bare mount points — see
// web/site/index.html). Checking the shells would only ever assert that they
// are still empty. So the landing's outbound links are asserted against
// site.js and the demo's back-link against demo/app.js, matching on the href
// string next to its stable id rather than on markup the page components own.
const siteJs = readFileSync(join(SITE, "site.js"), "utf8");
for (const [href, what] of [
  ['"./demo/"', "the demo"],
  ['"./download.html"', "the download page"],
  ['"./docs.html"', "the docs page"],
  ['"./checks.html"', "the checks reference"],
  // Reached from the landing tour's probe spotlight, not from the header nav.
  ['"./probe.html"', "the probe reference"],
]) {
  if (!siteJs.includes(href)) fail(`site/site.js has no ${href} link to ${what}`);
}
// The back-link is the only place in the app that navigates out of /demo/;
// keyed on its id so a stray "../" elsewhere in the bundle cannot satisfy it.
if (!appSource.includes("backToSite")) {
  fail('site/demo/app.js has no #backToSite element — the demo cannot link back to the landing');
}
if (!appSource.includes('"../"') && !appSource.includes("'../'")) {
  fail('site/demo/app.js has no "../" href — the back-link target is wrong or non-relative');
}

console.log("  cross-page links: landing -> demo/download/docs/checks/probe, demo -> landing");

console.log("OK: site/ present, within budget, leak-free, and Pages-subpath-safe");
