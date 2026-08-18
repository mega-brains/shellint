/**
 * The static build has no server to 404 at it, so an endpoint the UI calls but
 * `web/static/local-api.ts` does not handle fails *silently* on GitHub Pages —
 * a blank panel, no error. This test greps every endpoint literal out of web/
 * and asserts the router either handles it or deliberately rejects it as
 * device-only, so adding a new fetch to the UI without teaching the static
 * router about it is a test failure rather than a production mystery.
 *
 * Also bundles the static app to prove the `../lib/api` swap actually took:
 * the real `fetch`-based transport must be absent from the output entirely.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { staticAppEsbuildConfig } from "./static-esbuild.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** Every `.ts`/`.tsx` under web/, minus the static build's own modules. */
function webSources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "static") continue;
      webSources(path, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

// `api("/api/foo")`, `apiStream("/api/foo")`, and bare fetch in hover-docs.
const CALL = /\bapi(?:Stream)?<[^>]*>\(\s*[`"']([^`"']+)[`"']|\bapi(?:Stream)?\(\s*[`"']([^`"']+)[`"']/g;

const called = new Set();
for (const file of webSources(join(ROOT, "web"))) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(CALL)) {
    const raw = m[1] ?? m[2];
    if (raw?.startsWith("/api/")) called.add(raw.split("?")[0]);
  }
}
if (called.size === 0) fail("found no /api/ call sites in web/ — the grep is broken");

const router = readFileSync(join(ROOT, "web", "static", "local-api.ts"), "utf8");

/** `case "/api/x":` entries. */
const handled = new Set(
  [
    ...router.matchAll(/case\s+"([^"]+)"/g),
    ...router.matchAll(/path !== "(\/api\/[a-z/]+)"/g),
  ].map((m) => m[1]),
);
/** The device-prefix rejection list, plus routes handled by a prefix match
 *  (`/api/script/history/<iso>`, whose id can't be a case label). */
const prefixes = [
  ...[...router.matchAll(/"(\/api\/[a-z/]+)",/g)].map((m) => m[1]),
  ...[...router.matchAll(/startsWith\("(\/api\/[a-z/]+)"\)/g)].map((m) => m[1]),
];

const uncovered = [];
for (const path of called) {
  if (handled.has(path)) continue;
  // Template-literal paths like `/api/devices/${id}` reduce to their prefix.
  if (prefixes.some((p) => path.startsWith(p))) continue;
  uncovered.push(path);
}
if (uncovered.length) {
  fail(
    `local-api.ts has no handler and no device-rejection for:\n  ${uncovered.join("\n  ")}`,
  );
}

// The api() swap must genuinely replace the HTTP transport, not sit beside it.
const dir = mkdtempSync(join(tmpdir(), "shellint-static-app-"));
try {
  const outfile = join(dir, "app.js");
  const result = await esbuild.build(
    staticAppEsbuildConfig({
      entryPoints: [join(ROOT, "web", "shell", "main.tsx")],
      outfile,
      minify: true,
      logLevel: "silent",
    }),
  );
  if (result.errors.length) fail(`static app bundle failed:\n${JSON.stringify(result.errors)}`);
  const bundle = readFileSync(outfile, "utf8");
  if (bundle.includes("auth not supported yet")) {
    fail("web/lib/api.ts's fetch transport is still in the static bundle — the ../lib/api swap did not take");
  }
  const bytes = statSync(outfile).size;
  console.log(
    `OK: ${called.size} endpoint(s) covered by local-api.ts; static app bundle ${bytes} B, HTTP transport absent`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
