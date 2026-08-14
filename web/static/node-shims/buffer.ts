/**
 * Minimal `Buffer` shim for the browser worker bundle, wired via esbuild's
 * `inject` (scripts/static-esbuild.mjs) rather than `alias`: `Buffer` is a
 * bare global, not a module import, so `inject` is what lets every free
 * `Buffer` reference in the bundled server/lint/server/script graph resolve
 * here instead of throwing `ReferenceError: Buffer is not defined`.
 *
 * The only call shape across the pure lint/stats modules is
 * `Buffer.byteLength(text, "utf8")` (server/lint/lint-source.ts:184,196,
 * server/script/script-stats.ts:267, server/script/memory-estimate.ts:62) —
 * exactly what `TextEncoder`'s encoded length already gives (M17 plan §3).
 * The Node-based test harnesses (scripts/test-static-check.mjs,
 * test-static-pipeline.mjs) never caught the gap because plain Node already
 * has a real global `Buffer` — this shim only ever mattered in an actual
 * browser/Worker, which nothing exercised until the M17.8 e2e suite.
 */
export const Buffer = {
  byteLength(text: string): number {
    return new TextEncoder().encode(text).length;
  },
};
