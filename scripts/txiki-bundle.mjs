/**
 * Bundling for the txiki.js runtime, on esbuild directly.
 *
 * This used to shell out to `tjs bundle`, which is itself a wrapper that
 * downloads esbuild into `~/.tjs/esbuild/` and runs it with these same flags.
 * Going straight to the esbuild devDep the web build already pulls in removes
 * that indirection and, more importantly, removes a **platform floor**: the
 * `bundle` subcommand is compiled out of every slim profile
 * (`__TJS_BUNDLER__=false`), and upstream saghul/txiki.js v26.6.0 publishes no
 * Linux asset at all, so no released txiki binary anywhere can bundle on Linux.
 * esbuild ships prebuilt for every platform CI runs on.
 *
 * Equivalence measured 2026-08-25 against `tjs bundle` (which had fetched
 * esbuild 0.27.3/0.28.1) on the server entry: identical 6.3 MB bundle, and
 * `tjs compile` over it produced a 4,506,842-byte executable against
 * 4,506,881 — 39 bytes apart — that boots and serves `/` and `/api/checks`.
 *
 * See .claude/plans/2026-08-18_27_ci-deploy.md §4.
 */
import * as esbuild from "esbuild";

/**
 * The flags `tjs bundle` passed implicitly and esbuild will not infer:
 *
 * - `format: "esm"` — esbuild defaults to `iife`, which rejects the top-level
 *   `await` in `server/index.txiki.ts`.
 * - `external: ["tjs:*"]` — the `tjs:` scheme is the runtime's own module
 *   namespace (`tjs:hashing`, …); it resolves at run time, not bundle time.
 */
const IMPLICIT = {
  format: "esm",
  external: ["tjs:*"],
};

/**
 * Deliberately NOT `minify`: that implies `minifyWhitespace`, which collapses
 * the bundle onto one line, and QuickJS's parser is superlinear in line length.
 * Measured on the 4.5 MB server bundle: `tjs run` spends ~29 s parsing before
 * the first statement executes (whitespace-only minify is worse still, ~147 s),
 * against ~0.4 s for the two flags below. The `tjs compile` executable is
 * unaffected either way — it ships bytecode — and is in fact 59 KB *smaller*
 * built from this output.
 */
const SHARED = {
  bundle: true,
  minifyIdentifiers: true,
  minifySyntax: true,
  conditions: ["txiki"],
  platform: "browser",
  target: "es2022",
  define: {
    require: "undefined",
    process: "undefined",
    Buffer: "undefined",
  },
};

/** Bundles `entry` to `outfile` for txiki.js. Returns esbuild's result. */
export async function bundleForTxiki(entry, outfile, overrides = {}) {
  return esbuild.build({
    ...SHARED,
    ...IMPLICIT,
    entryPoints: [entry],
    outfile,
    ...overrides,
  });
}
