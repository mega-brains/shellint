/**
 * Hand-written types for espruino-entry.js, following the same pattern as
 * shared/*.d.mts: the .js stays plain (so a browser can load it without a
 * build step getting in the way of the dynamic import), and this file is its
 * TypeScript-facing signature. Only the three calls minify-adv-browser.ts
 * actually makes are typed — the rest of each library's surface is unused.
 */

export type EspruinoLibs = {
  esprima: {
    parse(code: string, options?: Record<string, unknown>): unknown;
  };
  esmangle: {
    optimize(
      tree: unknown,
      postDefaultPasses: unknown,
      options: Record<string, unknown>,
    ): unknown;
    mangle(tree: unknown): unknown;
  };
  escodegen: {
    generate(tree: unknown, options?: Record<string, unknown>): string;
  };
};

/** Resolves to `null` if the bundles loaded but didn't self-register as expected. */
export function loadEspruinoLibs(): Promise<EspruinoLibs | null>;
