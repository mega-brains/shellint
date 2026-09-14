/**
 * Plain static file server over `site/` — no framework, deliberately: the
 * whole point of `mise run preview:static` is to prove `build:static`'s
 * output needs nothing but a dumb file host (the way GitHub Pages serves it),
 * so reaching for a web framework here would undermine the thing it's proving.
 *
 * Usage: node scripts/preview-static.mjs [--port N]   (default 8788, or $PORT)
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(projectRoot, "site");

if (!existsSync(root)) {
  console.error(`FAIL: ${root} missing — run \`npm run build:static\` first`);
  process.exit(1);
}

const portArg = process.argv.indexOf("--port");
const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : Number(process.env.PORT) || 8788;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  // The hero video (M38). Unlike an image, media is not content-sniffed: a
  // <video> served as application/octet-stream simply refuses to play, so
  // previewing the landing locally would show a poster and nothing else.
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  // Strip a leading "/", collapse "..", then re-root under site/ — Pages-style
  // "/" -> index.html. Below that, `site/` has two more directories
  // (`demo/`) that need the same fallback: a request for "/demo/" (or
  // "/demo", no trailing slash) resolves to a directory, not a file, so
  // without this it 404s instead of serving demo/index.html. This used to be
  // claimed as "already handled" and wasn't — fixed here rather than in the
  // build, since the directory-index fallback is a webserver concern, not a
  // build-output one.
  let rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  if (rel === "/" || rel === "\\") rel = "/index.html";
  let full = join(root, rel);
  if (!full.startsWith(root)) return null; // path traversal guard
  if (existsSync(full) && statSync(full).isDirectory()) {
    full = join(full, "index.html");
  }
  if (existsSync(full) && statSync(full).isFile()) return full;
  return null;
}

/**
 * `Range` for the one case that needs it: seeking the hero video.
 *
 * Without a `206`, Chrome reports the media as unseekable and every
 * `currentTime` write clamps to 0 — the lightbox's scrubber does nothing and
 * the playhead handover (HeroShot in web/site/landing.tsx) looks broken
 * locally while working on Pages, which does answer ranges. Only the single
 * `bytes=a-b` form is handled; anything else falls through to a plain 200,
 * which is a legal answer to any range request.
 */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;
  // "bytes=-N" is the last N bytes, not a range starting at 0.
  const start = rawStart === "" ? Math.max(size - Number(rawEnd), 0) : Number(rawStart);
  const end = rawStart === "" || rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

const server = createServer((req, res) => {
  const found = resolvePath(req.url ?? "/");
  if (!found) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }
  const type = MIME[extname(found)] ?? "application/octet-stream";
  const size = statSync(found).size;
  const range = parseRange(req.headers.range, size);
  if (range) {
    res.writeHead(206, {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      "Content-Length": range.end - range.start + 1,
    });
    res.end(readFileSync(found).subarray(range.start, range.end + 1));
    return;
  }
  res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": size });
  res.end(readFileSync(found));
});

server.listen(port, () => {
  console.log(`preview:static — http://127.0.0.1:${port}/ (serving ${root})`);
});

const watchedPaths = ["web", "shared", "server", "scripts", "config", ".github/assets"]
  .map((path) => join(projectRoot, path))
  .filter(existsSync);
let timer;
let rebuilding = false;
let rebuildQueued = false;

function rebuild() {
  if (rebuilding) {
    rebuildQueued = true;
    return;
  }
  rebuilding = true;
  console.log("preview:static — rebuilding");
  const child = spawn("pnpm", ["run", "build:static"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    rebuilding = false;
    console.log(code === 0 ? "preview:static — rebuilt" : "preview:static — rebuild failed");
    if (rebuildQueued) {
      rebuildQueued = false;
      rebuild();
    }
  });
}

function scheduleRebuild() {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 100);
}

for (const path of watchedPaths) watch(path, { recursive: true }, scheduleRebuild);
console.log("preview:static — watching source changes");
