/**
 * Bundle the static/offline DevRoom (M17) into `site/`, deployable as-is to
 * GitHub Pages (or any plain static host):
 *
 *   index.html            copy of web/index.html + sw/manifest markup injected
 *   app.js                Preact UI, `../lib/api` aliased to web/static/local-api.ts
 *   pipeline.worker.js     TypeScript + Terser + tier 3, loaded lazily by worker-client.ts
 *   styles.css             same CSS bundle as the server build
 *   api-docs.json          hover-docs data, fetched at runtime (not bundled)
 *   sw.js                  cache-first precache of the six files above
 *   manifest.webmanifest
 *   .nojekyll              stop Pages' Jekyll step from touching `_`-prefixed paths
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
 * that exact filename; nothing here may rename either file.
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

rmSync(siteDir, { recursive: true, force: true });
mkdirSync(siteDir, { recursive: true });

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

const appOut = join(siteDir, "app.js");
await esbuild.build(
  staticAppEsbuildConfig({
    entryPoints: [join(root, "web", "shell", "main.tsx")],
    outfile: appOut,
    minify: true,
    sourcemap: false,
    logLevel: "info",
  }),
);

const workerOut = join(siteDir, "pipeline.worker.js");
await esbuild.build(
  staticEsbuildConfig({
    entryPoints: [join(root, "web", "static", "pipeline.worker.ts")],
    outfile: workerOut,
    minify: true,
    sourcemap: false,
    logLevel: "info",
  }),
);

const cssOut = join(siteDir, "styles.css");
await esbuild.build({
  entryPoints: [join(root, "web", "styles.entry.css")],
  bundle: true,
  outfile: cssOut,
  minify: true,
  logLevel: "info",
});

const docsOut = join(siteDir, "api-docs.json");
copyFileSync(join(root, "types", "api-docs.json"), docsOut);

// ---------------------------------------------------------- manifest + html

const manifestOut = join(siteDir, "manifest.webmanifest");
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

const htmlOut = join(siteDir, "index.html");
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

// ------------------------------------------------------------------- sw.js

// Every file a first visit needs, offline-cacheable and same-origin. Order
// doesn't matter to Cache.addAll; index.html appears twice (as "./" and by
// name) since a request for the scope root and a request for "index.html"
// are different Request objects the cache must match independently.
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
// correct under GitHub Pages' "/<repo>/" subpath.
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
writeFileSync(join(siteDir, "sw.js"), swSource);

// ------------------------------------------------------------------ report

for (const f of ["index.html", "app.js", "pipeline.worker.js", "styles.css", "api-docs.json", "sw.js", "manifest.webmanifest", ".nojekyll"]) {
  const p = join(siteDir, f);
  if (!existsSync(p)) {
    console.error(`FAIL: build-static.mjs did not produce site/${f}`);
    process.exit(1);
  }
  console.log(`site/${f}  ${statSync(p).size} B`);
}
