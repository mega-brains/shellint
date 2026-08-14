/**
 * Shared esbuild config for the M17 static/offline bundle
 * (`web/static/pipeline.worker.ts`, entry point for both the device build
 * and, as of M17.4, the compliance check). One function so
 * `scripts/test-static-pipeline.mjs` and `scripts/test-static-check.mjs`
 * bundle exactly what `build:static` (M17.7) will ship — no config drift
 * between what the tests exercise and what a browser actually loads.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHIMS = path.join(ROOT, "web", "static", "node-shims");

/**
 * Must match `web/static/vfs.ts`'s `REPO_ROOT` — this is the fixed
 * `import.meta.url` the bundle sees in place of its own real load location,
 * so `server/core/paths.ts`'s `join(dirname(fileURLToPath(import.meta.url)),
 * "..", "..")` collapses back onto exactly that constant (see
 * `web/static/node-shims/url.ts`). Two hops up from
 * `<REPO_ROOT>/web/static/__anchor__.js` lands on `<REPO_ROOT>`, mirroring
 * `server/core/paths.ts`'s real `ROOT` (grandparent of `core/`).
 */
const STATIC_IMPORT_META_URL = "/repo/web/static/__anchor__.js";

/**
 * `require: "undefined"` works around a real crash, not a style choice.
 * `typescript`'s package.json (`node_modules/typescript/package.json`
 * `"browser"` field) disables `fs`/`os`/`path`/`crypto` for bundlers, but its
 * own top-level `sys` initializer (`node_modules/typescript/lib/typescript.js`,
 * `isNodeLikeSystem`) still checks `typeof require !== "undefined"` to decide
 * whether to call `getNodeSystem()` — and esbuild's own `__require` polyfill
 * is never itself `undefined` inside a bundle, so that check is true
 * regardless of platform. Left undefined, merely `import ts from
 * "typescript"` throws `_os.platform is not a function` the instant the
 * bundle loads (verified empirically, in Node *and* emulated-browser
 * execution of the bundled output — this is not a hypothetical). Defining
 * the free identifier `require` as literal `undefined` makes that guard fold
 * to false at build time, so `ts.sys` ends up correctly `undefined` instead
 * of a half-initialized Node system — `ts.createSourceFile`/`transpileModule`
 * never touch `sys` at all, so this is enough to make every lint pass and
 * the device transpile work. `ts.createProgram` (dead-code, §8) still needs
 * *some* sys and is handled separately (see pipeline.worker.ts).
 */
export function staticEsbuildConfig(overrides = {}) {
  return {
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    define: {
      require: "undefined",
      "import.meta.url": JSON.stringify(STATIC_IMPORT_META_URL),
    },
    alias: {
      "node:fs": path.join(SHIMS, "fs.ts"),
      "node:path": path.join(SHIMS, "path.ts"),
      "node:url": path.join(SHIMS, "url.ts"),
      "node:crypto": path.join(SHIMS, "crypto.ts"),
      // See web/static/ts-dead-code-guard.ts: makes ts.createProgram fail
      // soft instead of crashing runCheck() (deadCodeFindings has no host).
      typescript: path.join(ROOT, "web", "static", "ts-dead-code-guard.ts"),
    },
    // `Buffer` is a bare global, not a module specifier `alias` can catch —
    // `inject` rewrites every free reference to import it from the shim.
    // See web/static/node-shims/buffer.ts for why this is needed at all.
    inject: [path.join(SHIMS, "buffer.ts")],
    ...overrides,
  };
}

/**
 * Redirects every `../lib/api` import to web/static/local-api.ts. esbuild's
 * `alias` option only substitutes package specifiers, and all 16 call sites
 * import the module by relative path (verified: they are uniformly
 * `"../lib/api"`), so this has to be a resolve plugin. Swapping this one
 * module is what puts the whole UI on the local router without touching a
 * single component — M17 plan §1.
 */
function localApiPlugin(root) {
  const target = path.join(root, "web", "static", "local-api.ts");
  return {
    name: "devroom-local-api",
    setup(build) {
      build.onResolve({ filter: /^\.\.\/lib\/api$/ }, () => ({ path: target }));
    },
  };
}

/**
 * The app bundle, as opposed to the worker bundle above. It gets neither the
 * node shims nor the pinned `import.meta.url`: nothing on the main thread
 * touches the VFS (everything filesystem-shaped lives behind the worker), and
 * worker-client.ts needs the *real* `import.meta.url` to locate
 * pipeline.worker.js next to the emitted app.js.
 */
export function staticAppEsbuildConfig(overrides = {}) {
  return {
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    jsx: "automatic",
    jsxImportSource: "preact",
    plugins: [localApiPlugin(ROOT)],
    ...overrides,
  };
}
