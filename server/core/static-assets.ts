import type { Context } from "./context.ts";
import { runtime } from "#shellint/runtime";
import { ROOT, WEB_DIR } from "./paths.ts";
import { embeddedAsset } from "./embedded-assets.ts";

const { join, normalize, relative } = runtime.path;
const DIST = join(WEB_DIR, "dist");

async function readBody(file: string): Promise<ArrayBuffer> {
  return (await runtime.fs.readBytes(file)).slice().buffer as ArrayBuffer;
}

/**
 * Serve `path` from the assets compiled into the executable, if it has any.
 * Returns `undefined` in every other build, which is what keeps the filesystem
 * path below the normal one — see embedded-assets.ts.
 *
 * The brotli bodies are served even to a client that did not advertise `br`.
 * In the single-file binary there is no identity copy to fall back to, and the
 * only client that fetches these four paths is a browser, all of which send
 * `Accept-Encoding: br`. A checkout never reaches this branch at all.
 */
function sendEmbedded(c: Context, path: string): Response | undefined {
  const asset = embeddedAsset(path);
  if (!asset) return undefined;
  c.header("Content-Type", asset.type);
  c.header("Vary", "Accept-Encoding");
  if (asset.encoding) c.header("Content-Encoding", asset.encoding);
  return c.body(asset.bytes.slice().buffer as ArrayBuffer);
}

/**
 * Serve a build artifact, preferring the precompressed sibling the build wrote
 * (scripts/build-web.mjs emits .br and .gz next to each output).
 *
 * Falls back to the raw file whenever the client will not take the encoding or
 * the sibling is missing — a dev build, or a web/dist left over from an older
 * checkout, still serves correctly, just uncompressed.
 */
export async function sendAsset(c: Context, file: string, contentType: string) {
  const accepted = c.req.header("accept-encoding") ?? "";
  c.header("Content-Type", contentType);
  c.header("Vary", "Accept-Encoding");

  for (const [encoding, suffix] of [
    ["br", ".br"],
    ["gzip", ".gz"],
  ] as const) {
    if (!accepted.includes(encoding)) continue;
    const packed = file + suffix;
    if (!(await runtime.fs.exists(packed))) continue;
    c.header("Content-Encoding", encoding);
    return c.body(await readBody(packed));
  }
  return c.body(await readBody(file));
}

/** GET /app.js — the bundled SPA. */
export async function appJs(c: Context) {
  const packed = sendEmbedded(c, "/app.js");
  if (packed) return packed;
  const js = join(DIST, "app.js");
  if (!(await runtime.fs.exists(js))) {
    return c.text(
      "console.error('web bundle missing — run: npm run build:web');",
      503,
    );
  }
  return sendAsset(c, js, "application/javascript; charset=utf-8");
}

/** GET /app.js.map — dev builds only; prod omits the map entirely. */
export async function appJsMap(c: Context) {
  const map = join(DIST, "app.js.map");
  if (!(await runtime.fs.exists(map))) return c.text("not found", 404);
  c.header("Content-Type", "application/json");
  return c.body(await readBody(map));
}

/**
 * GET /api-docs.json — hover-tooltip data, fetched by the UI instead of being
 * bundled into app.js. Served from web/dist when built, else from types/.
 */
export async function apiDocsJson(c: Context) {
  const packed = sendEmbedded(c, "/api-docs.json");
  if (packed) return packed;
  const built = join(DIST, "api-docs.json");
  if (await runtime.fs.exists(built)) return sendAsset(c, built, "application/json");
  const source = join(ROOT, "types", "api-docs.json");
  if (!(await runtime.fs.exists(source))) return c.text("not found", 404);
  c.header("Content-Type", "application/json");
  return c.body(await readBody(source));
}

/**
 * GET /<name>.css — the bundled web/dist/styles.css when a build has run,
 * otherwise the individual web/*.css source file of that name, so an unbuilt
 * checkout still renders.
 */
export async function css(c: Context, name: string) {
  const packed = sendEmbedded(c, `/${name}`);
  if (packed) return packed;
  const built = join(DIST, name);
  if (await runtime.fs.exists(built)) {
    return sendAsset(c, built, "text/css; charset=utf-8");
  }
  const source = join(WEB_DIR, name);
  if (!(await runtime.fs.exists(source))) return c.text("not found", 404);
  c.header("Content-Type", "text/css; charset=utf-8");
  return c.body(await runtime.fs.readText(source));
}

const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** Node-free fallback for source maps and other files below web/. */
export async function webAsset(c: Context) {
  const requested = c.req.path.slice(1);
  const file = normalize(join(ROOT, requested));
  const rel = relative(WEB_DIR, file);
  if (rel === ".." || rel.startsWith(`..${runtime.path.sep}`)) {
    return c.text("not found", 404);
  }
  if (!(await runtime.fs.exists(file))) return c.text("not found", 404);
  const type = TYPES[runtime.path.extname(file)] ?? "application/octet-stream";
  return sendAsset(c, file, type);
}
