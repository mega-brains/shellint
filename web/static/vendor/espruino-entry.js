/**
 * Lazily loads Espruino's vendored esprima/esmangle/escodegen bundles
 * (node_modules/espruino/libs/esprima/*.js — 446 KB, so never eagerly). They
 * are the offline "ESPRIMA" tier-3 minifier node_modules/espruino/plugins/
 * minify.js drives (its `case "ESPRIMA"` branch); minify-adv-browser.ts
 * reimplements that branch's three-call sequence directly rather than
 * pulling in the whole Espruino Web IDE plugin, which expects a global
 * `Espruino.Core.*` app we don't have.
 *
 * These bundles were built *for* the Espruino Web IDE and self-register onto
 * `window.<name>` as a load-time side effect rather than exporting an ESM
 * binding. A Worker has no `window` (only `self`), so this shim aliases it
 * before the libs load — locked as necessary by the M17 plan's POC (a `vm`
 * context lacking `window` failed the same way). Loading them via dynamic
 * `import()` rather than a static import is what makes the ordering work at
 * all: static imports are hoisted above every other top-level statement and
 * would run before the alias below is ever set.
 */

/** @type {Promise<import("./espruino-entry.d.ts").EspruinoLibs | null> | undefined} */
let libsPromise;

/**
 * @param {string} specifier
 * @param {string} globalName name the UMD bundle is expected to self-register as
 */
async function loadGlobal(specifier, globalName) {
  const ns = await import(specifier);
  // Prefer whatever the UMD bundle assigned onto the real global object (the
  // window shim above is what makes that assignment land); fall back to the
  // module's own export in case a bundler's CommonJS auto-detection routed
  // the assignment through `module.exports` instead.
  return globalThis[globalName] ?? ns.default ?? ns[globalName];
}

/** @returns {Promise<import("./espruino-entry.d.ts").EspruinoLibs | null>} */
export function loadEspruinoLibs() {
  if (!libsPromise) {
    libsPromise = (async () => {
      globalThis.window = globalThis;
      const [esprima, esmangle, escodegen] = await Promise.all([
        loadGlobal("espruino/libs/esprima/esprima.js", "esprima"),
        loadGlobal("espruino/libs/esprima/esmangle.js", "esmangle"),
        loadGlobal("espruino/libs/esprima/escodegen.js", "escodegen"),
      ]);
      if (!esprima || !esmangle || !escodegen) return null;
      return { esprima, esmangle, escodegen };
    })();
  }
  return libsPromise;
}
