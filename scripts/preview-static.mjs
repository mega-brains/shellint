/**
 * Plain static file server over `site/` — no framework, deliberately: the
 * whole point of `mise run preview:static` is to prove `build:static`'s
 * output needs nothing but a dumb file host (the way GitHub Pages serves it),
 * so reaching for a web framework here would undermine the thing it's proving.
 *
 * Usage: node scripts/preview-static.mjs [--port N]   (default 8788, or $PORT)
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "site");

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

const server = createServer((req, res) => {
  const found = resolvePath(req.url ?? "/");
  if (!found) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }
  const type = MIME[extname(found)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(readFileSync(found));
});

server.listen(port, () => {
  console.log(`preview:static — http://127.0.0.1:${port}/ (serving ${root})`);
});
