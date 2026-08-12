import type { Context } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, WEB_DIR } from "./paths.ts";

const DIST = join(WEB_DIR, "dist");

/**
 * Serve a build artifact, preferring the precompressed sibling the build wrote
 * (scripts/build-web.mjs emits .br and .gz next to each output).
 *
 * Falls back to the raw file whenever the client will not take the encoding or
 * the sibling is missing — a dev build, or a web/dist left over from an older
 * checkout, still serves correctly, just uncompressed.
 */
export function sendAsset(c: Context, file: string, contentType: string) {
  const accepted = c.req.header("accept-encoding") ?? "";
  c.header("Content-Type", contentType);
  c.header("Vary", "Accept-Encoding");

  for (const [encoding, suffix] of [
    ["br", ".br"],
    ["gzip", ".gz"],
  ] as const) {
    if (!accepted.includes(encoding)) continue;
    const packed = file + suffix;
    if (!existsSync(packed)) continue;
    c.header("Content-Encoding", encoding);
    return c.body(readFileSync(packed));
  }
  return c.body(readFileSync(file));
}

/** GET /app.js — the bundled SPA. */
export function appJs(c: Context) {
  const js = join(DIST, "app.js");
  if (!existsSync(js)) {
    return c.text(
      "console.error('web bundle missing — run: npm run build:web');",
      503,
    );
  }
  return sendAsset(c, js, "application/javascript; charset=utf-8");
}

/** GET /app.js.map — dev builds only; prod omits the map entirely. */
export function appJsMap(c: Context) {
  const map = join(DIST, "app.js.map");
  if (!existsSync(map)) return c.text("not found", 404);
  c.header("Content-Type", "application/json");
  return c.body(readFileSync(map));
}

/**
 * GET /api-docs.json — hover-tooltip data, fetched by the UI instead of being
 * bundled into app.js. Served from web/dist when built, else from types/.
 */
export function apiDocsJson(c: Context) {
  const built = join(DIST, "api-docs.json");
  if (existsSync(built)) return sendAsset(c, built, "application/json");
  const source = join(ROOT, "types", "api-docs.json");
  if (!existsSync(source)) return c.text("not found", 404);
  c.header("Content-Type", "application/json");
  return c.body(readFileSync(source));
}

/**
 * GET /<name>.css — the bundled web/dist/styles.css when a build has run,
 * otherwise the individual web/*.css source file of that name, so an unbuilt
 * checkout still renders.
 */
export function css(c: Context, name: string) {
  const built = join(DIST, name);
  if (existsSync(built)) {
    return sendAsset(c, built, "text/css; charset=utf-8");
  }
  const source = join(WEB_DIR, name);
  if (!existsSync(source)) return c.text("not found", 404);
  c.header("Content-Type", "text/css; charset=utf-8");
  return c.body(readFileSync(source, "utf8"));
}
