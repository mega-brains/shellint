/**
 * Bundle the presentation site into `site/`, deployable as-is to GitHub Pages
 * (or any plain static host). M26 wraps the M17 offline app (still fully
 * self-contained, still device-less) inside a small landing/download shell:
 *
 *   index.html            landing page                       (new, M26)
 *   download.html         releases page                       (new, M26)
 *   site.js               landing+download Preact bundle       (new, M26)
 *   site.css              tokens.css + site-only layout CSS    (new, M26)
 *   devroom-header.png    hero screenshot, copied from repo root (new, M26)
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
      name: "Shelly DevRoom (static)",
      short_name: "DevRoom",
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
  writeFileSync(htmlOut, withSw);
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
const CACHE = "devroom-static-${stamp}";
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
// The landing+download shell, wholly independent of demo/. One JS bundle (two
// pages, chosen at runtime off `document.body.dataset.page` — see
// web/site/main.tsx) and one CSS bundle, both built straight into site/ (not
// site/demo/) since they are the outer shell the demo lives inside of.
//
// REPO (web/site/release.ts) is read through the `__DEVROOM_REPO__` global —
// `declare const __DEVROOM_REPO__: string;` in that file — so CI can inject
// the real "owner/repo" slug once the GitHub repo exists without touching
// source (M26 plan §7.6); DEVROOM_REPO unset falls back to a placeholder.
const siteJsOut = join(siteDir, "site.js");
await esbuild.build(
  staticAppEsbuildConfig({
    entryPoints: [join(root, "web", "site", "main.tsx")],
    outfile: siteJsOut,
    minify: true,
    sourcemap: false,
    logLevel: "info",
    define: {
      __DEVROOM_REPO__: JSON.stringify(process.env.DEVROOM_REPO || "OWNER/shelly-devroom"),
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

// web/site/{index,download}.html are shipped verbatim: they already carry
// their own `<link href="./site.css">` and `<script src="./site.js">` tags
// (unlike demo/index.html, there is no server-shared shell to inject markup
// into here), so this is a plain copy, not a template step.
copyFileSync(join(root, "web", "site", "index.html"), join(siteDir, "index.html"));
copyFileSync(join(root, "web", "site", "download.html"), join(siteDir, "download.html"));

// The one image the site ships (M26 plan §5) — the landing hero screenshot,
// committed at the repo root rather than under web/ so it isn't mistaken for
// something the app bundle needs.
copyFileSync(join(root, "devroom-header.png"), join(siteDir, "devroom-header.png"));

// ------------------------------------------------------------------ report

for (const f of ["index.html", "download.html", "site.js", "site.css", "devroom-header.png", ".nojekyll"]) {
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
