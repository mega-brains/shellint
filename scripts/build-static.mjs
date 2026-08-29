/**
 * Bundle the presentation site into `site/`, deployable as-is to GitHub Pages
 * (or any plain static host). M26 wraps the M17 offline app (still fully
 * self-contained, still device-less) inside a small landing/download shell:
 *
 *   index.html            landing page                       (new, M26)
 *   download.html         releases page                       (new, M26)
 *   docs.html             prose documentation
 *   checks.html           the check catalog, rendered from server/lint/
 *   probe.html            the capability probe explained, plus its catalog,
 *                         rendered from server/probe/
 *   site.js               Preact bundle for every site page       (new, M26)
 *   site.css              tokens.css + site-only layout CSS    (new, M26)
 *   shellint-header.png        hero screenshot, light  (from .github/assets, M26)
 *   shellint-header-dark.png   hero screenshot, dark   (from .github/assets, M26)
 *   .nojekyll              stop Pages' Jekyll step from touching `_`-prefixed
 *                          paths — applies to the whole publish, stays at root
 *   demo/
 *     index.html            copy of web/index.html + sw/manifest markup
 *     app.js                Preact UI, `../lib/api` aliased to
 *                            web/static/local-api.ts
 *     pipeline.worker.js     TypeScript + Terser + tier 3, loaded lazily by
 *                            worker-client.ts
 *     styles.css             same CSS bundle as the server build
 *     api-docs.json           hover-docs data, fetched at runtime (not
 *                             bundled)
 *     sw.js                   cache-first precache of the six files above,
 *                             scope narrowed to /demo/ by living here
 *     manifest.webmanifest
 *
 * `site/demo/` is exactly the M17 static/offline build, one path level down —
 * see M26 plan §3–4 for why: the landing/download shell needed a home that
 * wasn't "the app, bare", and moving the app rather than nesting the shell
 * keeps every asset reference inside `demo/` relative and untouched.
 *
 * Deliberately **not** precompressed: GitHub Pages gzips its own responses and
 * will not serve `.br`/`.gz` siblings (unlike server/core/static-assets.ts's
 * Accept-Encoding negotiation over web/dist/), so shipping them here would
 * just be dead weight — scripts/build-web.mjs's precompress() is not reused.
 *
 * `app.js` and `pipeline.worker.js` are two separate esbuild entry points/
 * outfiles, not one bundle with a dynamic import: that is what keeps the
 * worker (TypeScript + Terser, ~4 MB) out of the initial chunk, the entire
 * point of M17's worker split (plan §10). worker-client.ts resolves the
 * worker as `new URL("pipeline.worker.js", import.meta.url)` — a bare
 * specifier esbuild does not rewrite — so it MUST land next to app.js under
 * that exact filename, both now inside `demo/`; nothing here may rename
 * either file or separate them.
 *
 * `site.js`/`site.css` (the landing+download bundle) are a third, wholly
 * independent esbuild entry pair built from `web/site/*` — reusing
 * `staticAppEsbuildConfig` for the JS (same jsx/preact settings and the
 * local-api resolve plugin, though the site pages never call the API) but a
 * fresh CSS entry (`web/site/site.entry.css`), not `web/styles.entry.css`:
 * the landing has no editor, no dock, no panels, and 35 KB of app CSS on a
 * landing page would be waste (M26 plan §7.3).
 *
 * Usage: node scripts/build-static.mjs
 */
import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { staticAppEsbuildConfig, staticEsbuildConfig } from "./static-esbuild.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(root, "site");
const demoDir = join(siteDir, "demo");

// ------------------------------------------------------- analytics beacon
//
// Origin of a deployed cookieless pageview collector, e.g.
// `https://stats.example.com`. Read from the environment and deliberately NOT
// hardcoded — not even split across expressions, which would still reconstruct
// the host for anyone reading this file. Unset (the default, and every fork)
// omits the beacon entirely, so `site/` builds and works with no analytics
// rather than emitting a tag that 404s on every page.
//
// This only keeps the host out of *git*. Whatever value is set at build time is
// baked into the published HTML as a `<script src>` every visitor can read — a
// browser beacon URL cannot be secret. Point a custom domain at the collector if
// the origin itself should stay unadvertised.
//
// Scheme is optional in the env var: a bare `stats.example.com` would otherwise
// build a *relative* `<script src>` that resolves against the Pages host and
// 404s, with no build error.
const COLLECTOR_RAW = process.env.COLLECTOR_ORIGIN?.trim().replace(/\/+$/, "");
const COLLECTOR = COLLECTOR_RAW
  ? /^https?:\/\//.test(COLLECTOR_RAW)
    ? COLLECTOR_RAW
    : `https://${COLLECTOR_RAW}`
  : undefined;

// Must be an id the collector already knows: an unlisted id resolves to null and
// the beacon then returns the same response while writing nothing, so a typo
// here is silent. Verify against the collector, not against this file.
const SITE_ID = process.env.COLLECTOR_SITE_ID ?? "shellint";

// Feature events (web/static/analytics.ts) need no configuration here: they go
// through `globalThis.__da.trackEvent`, published by the same s.js this tag
// loads, which already carries the collector origin and the site id.

/**
 * Inject the beacon before `</head>`. No-op when COLLECTOR is unset, which is
 * the default everywhere except the Pages deploy — so the local build, the
 * gate's `test-static-bundle.mjs` byte budgets and a fork's output are all
 * unchanged by this. `defer` so it never blocks first paint; the tag is
 * cross-origin, so offline (the demo is a service-worker app) it simply fails
 * to load and the page is unaffected.
 */
function withBeacon(html) {
  if (!COLLECTOR) return html;
  const tag = `    <script defer src="${COLLECTOR}/s.js" data-site="${SITE_ID}"></script>\n  </head>`;
  const out = html.replace("</head>", tag);
  if (out === html) {
    console.error("FAIL: build-static.mjs found no </head> to inject the analytics beacon into");
    process.exit(1);
  }
  return out;
}

rmSync(siteDir, { recursive: true, force: true });
mkdirSync(siteDir, { recursive: true });
mkdirSync(demoDir, { recursive: true });

// Same precondition as build-web.mjs: regenerate before bundling so a stale
// types/api-docs.json (or one that was never generated in a fresh checkout)
// never ships.
{
  const r = spawnSync("node", [join(root, "scripts", "gen-api-docs.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error("FAIL: scripts/gen-api-docs.mjs failed");
    process.exit(1);
  }
}

// ------------------------------------------------------------------- demo/

const appOut = join(demoDir, "app.js");
await esbuild.build(
  staticAppEsbuildConfig({
    entryPoints: [join(root, "web", "shell", "main.tsx")],
    outfile: appOut,
    minify: true,
    sourcemap: false,
    logLevel: "info",
  }),
);

const workerOut = join(demoDir, "pipeline.worker.js");
await esbuild.build(
  staticEsbuildConfig({
    entryPoints: [join(root, "web", "static", "pipeline.worker.ts")],
    outfile: workerOut,
    minify: true,
    sourcemap: false,
    logLevel: "info",
  }),
);

const cssOut = join(demoDir, "styles.css");
await esbuild.build({
  entryPoints: [join(root, "web", "styles.entry.css")],
  bundle: true,
  outfile: cssOut,
  minify: true,
  logLevel: "info",
});

const docsOut = join(demoDir, "api-docs.json");
copyFileSync(join(root, "types", "api-docs.json"), docsOut);

// ---------------------------------------------------------- manifest + html

const manifestOut = join(demoDir, "manifest.webmanifest");
writeFileSync(
  manifestOut,
  `${JSON.stringify(
    {
      name: "shellint (static)",
      short_name: "shellint",
      description: "Offline Shelly Gen2 script playground — build, lint, and download, no server.",
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: "#f4f1ea",
      theme_color: "#0b5649",
    },
    null,
    2,
  )}\n`,
);

const htmlOut = join(demoDir, "index.html");
{
  const html = readFileSync(join(root, "web", "index.html"), "utf8");
  // Markup the server build has no reason to carry — injected here rather
  // than into web/index.html itself (M17 plan §6: one index.html serves both).
  const withManifest = html.replace(
    "</head>",
    '    <link rel="manifest" href="./manifest.webmanifest" />\n  </head>',
  );
  const withSw = withManifest.replace(
    "</body>",
    [
      "    <script>",
      '      if ("serviceWorker" in navigator) {',
      '        window.addEventListener("load", () => {',
      '          navigator.serviceWorker.register("./sw.js");',
      "        });",
      "      }",
      "    </script>",
      "  </body>",
    ].join("\n"),
  );
  if (withSw === html) {
    console.error("FAIL: web/index.html has no </head> or </body> to inject into");
    process.exit(1);
  }
  // Before the sw.js precache hash below, which is computed over this file —
  // so enabling the beacon busts the service-worker cache like any other
  // change to the shell, instead of leaving repeat visitors on a stale copy.
  writeFileSync(htmlOut, withBeacon(withSw));
}

writeFileSync(join(siteDir, ".nojekyll"), "");

// --------------------------------------------------------------- demo/sw.js

// Every file a first visit needs, offline-cacheable and same-origin. Order
// doesn't matter to Cache.addAll; index.html appears twice (as "./" and by
// name) since a request for the scope root and a request for "index.html"
// are different Request objects the cache must match independently. All
// entries stay relative, so moving this file into demo/ narrows the service
// worker's registration scope to "/demo/" without changing a single line here
// (M26 plan §3).
const PRECACHE = [
  "./",
  "./index.html",
  "./app.js",
  "./pipeline.worker.js",
  "./styles.css",
  "./api-docs.json",
  "./manifest.webmanifest",
];

// Content hash (not Date.now()): identical output across two builds gets the
// same cache name, so a no-op redeploy doesn't force every client to
// re-download; any real change gets a fresh name, which the activate handler
// below uses to evict the old cache — "so a redeploy doesn't serve stale
// assets forever" (M17 plan §6).
const stamp = createHash("sha256")
  .update(readFileSync(appOut))
  .update(readFileSync(workerOut))
  .update(readFileSync(cssOut))
  .update(readFileSync(docsOut))
  .update(readFileSync(htmlOut))
  .digest("hex")
  .slice(0, 12);

const swSource = `// Generated by scripts/build-static.mjs — do not hand-edit.
// Cache-first precache; registered as "./sw.js" (relative) so the scope is
// correct under GitHub Pages' "/<repo>/demo/" subpath.
const CACHE = "shellint-static-${stamp}";
const ASSETS = ${JSON.stringify(PRECACHE)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
`;
writeFileSync(join(demoDir, "sw.js"), swSource);

// --------------------------------------------------------------- site/*.{js,css}
//
// The landing/download/docs/checks shell, wholly independent of demo/. One JS
// bundle (four pages, chosen at runtime off `document.body.dataset.page` — see
// web/site/main.tsx) and one CSS bundle, both built straight into site/ (not
// site/demo/) since they are the outer shell the demo lives inside of.
//
// REPO (web/site/release.ts) is read through the `__SHELLINT_REPO__` global —
// `declare const __SHELLINT_REPO__: string;` in that file — so CI can inject
// the real "owner/repo" slug without touching source (M26 plan §7.6). ci.yml
// and pages.yml both set it to `${{ github.repository }}`, so the fallback
// below only ever shows up in a local `mise run build:static`.
const siteJsOut = join(siteDir, "site.js");
await esbuild.build(
  staticAppEsbuildConfig({
    entryPoints: [join(root, "web", "site", "main.tsx")],
    outfile: siteJsOut,
    minify: true,
    sourcemap: false,
    logLevel: "info",
    define: {
      __SHELLINT_REPO__: JSON.stringify(process.env.SHELLINT_REPO || "mega-brains/shellint"),
    },
  }),
);

const siteCssOut = join(siteDir, "site.css");
await esbuild.build({
  entryPoints: [join(root, "web", "site", "site.entry.css")],
  bundle: true,
  outfile: siteCssOut,
  minify: true,
  logLevel: "info",
});

// web/site/{index,download}.html already carry their own
// `<link href="./site.css">` and `<script src="./site.js">` tags (unlike
// demo/index.html, there is no server-shared shell to inject markup into here),
// so this is a read-through, not a template step — the only edit is the
// analytics beacon, and with COLLECTOR_ORIGIN unset it is a byte-for-byte copy.
for (const page of ["index.html", "download.html", "docs.html", "checks.html", "probe.html"]) {
  const src = readFileSync(join(root, "web", "site", page), "utf8");
  writeFileSync(join(siteDir, page), withBeacon(src));
}

// The only images the site ships (M26 plan §5) — the landing hero screenshot
// in both themes, since web/site/landing.tsx picks one off the visitor's
// current theme. Committed under .github/assets/ rather than under web/ so they
// aren't mistaken for something the app bundle needs; they land flat at the
// site root, which is the path landing.tsx asks for.
for (const img of ["shellint-header.png", "shellint-header-dark.png"]) {
  copyFileSync(join(root, ".github", "assets", img), join(siteDir, img));
}

// The landing tour's crops, cut out of those same two shots by
// scripts/crop-docs-figures.mjs and committed next to them. Copied as a
// directory listing rather than a hard-coded list so adding a figure to
// landing.tsx's TOUR means re-running the crop script and nothing here.
const figuresSrc = join(root, ".github", "assets", "figures");
mkdirSync(join(siteDir, "figures"), { recursive: true });
for (const img of readdirSync(figuresSrc)) {
  copyFileSync(join(figuresSrc, img), join(siteDir, "figures", img));
}

// ------------------------------------------------------------------ report

for (const f of [
  "index.html",
  "download.html",
  "docs.html",
  "checks.html",
  "probe.html",
  "site.js",
  "site.css",
  "shellint-header.png",
  "shellint-header-dark.png",
  "figures/inspector-sizes.png",
  "figures/inspector-sizes-dark.png",
  ".nojekyll",
]) {
  const p = join(siteDir, f);
  if (!existsSync(p)) {
    console.error(`FAIL: build-static.mjs did not produce site/${f}`);
    process.exit(1);
  }
  console.log(`site/${f}  ${statSync(p).size} B`);
}

for (const f of ["index.html", "app.js", "pipeline.worker.js", "styles.css", "api-docs.json", "sw.js", "manifest.webmanifest"]) {
  const p = join(demoDir, f);
  if (!existsSync(p)) {
    console.error(`FAIL: build-static.mjs did not produce site/demo/${f}`);
    process.exit(1);
  }
  console.log(`site/demo/${f}  ${statSync(p).size} B`);
}
