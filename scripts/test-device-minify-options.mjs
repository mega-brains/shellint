/**
 * The four M15 device-pipeline minify options (P3–P5): dropConsole, passes,
 * hoistProps, deviceDCE. Exercises the pure functions build-shelly.mjs
 * exports (envPass, minifyPass, resolveVariantOptions, deviceGlobalDefs)
 * directly against small fixtures — no devroom.json involved, so this never
 * touches the user's live device config.
 * Usage: node scripts/test-device-minify-options.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MINIFY } from "../shared/minify-options.mjs";
import {
  deviceGlobalDefs,
  envPass,
  minifyPass,
  resolveVariantOptions,
} from "./build-shelly.mjs";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const eq = (got, want, what) => {
  if (got !== want) {
    fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};

const tmp = mkdtempSync(join(tmpdir(), "devroom-test-"));
try {
  // --- resolveVariantOptions: scope enforcement ---------------------------
  {
    const cfg = { ...DEFAULT_MINIFY, dropConsole: true, passes: true };
    const prodOpts = resolveVariantOptions(cfg, "prod");
    const debugOpts = resolveVariantOptions(cfg, "debug");
    eq(prodOpts.dropConsole, true, "dropConsole (scope prod) stays on for prod");
    eq(debugOpts.dropConsole, false, "dropConsole (scope prod) forced off for debug");
    eq(prodOpts.passes, true, "passes (scope both) stays on for prod");
    eq(debugOpts.passes, true, "passes (scope both) stays on for debug");
  }

  // --- dropConsole: strips console.* in prod, never in debug --------------
  {
    const src = 'console.log("hi", x); print("#m t " + x); print("ok");';
    const prodOpts = resolveVariantOptions(
      { ...DEFAULT_MINIFY, dropConsole: true },
      "prod",
    );
    const debugOpts = resolveVariantOptions(
      { ...DEFAULT_MINIFY, dropConsole: true },
      "debug",
    );
    const prodOut = await minifyPass(src, prodOpts);
    const debugOut = await minifyPass(src, debugOpts);
    if (prodOut.includes("console.log")) {
      fail(`dropConsole on prod must strip console.log: ${prodOut}`);
    }
    if (!prodOut.includes("#m t") || !prodOut.includes('print("ok")')) {
      fail(`dropConsole must not touch the print() metric channel: ${prodOut}`);
    }
    if (!debugOut.includes("console.log")) {
      fail(`dropConsole must never reach the debug variant: ${debugOut}`);
    }

    // drop_console is a compress transform — it must still fire when the
    // separate `compress` knob is off, or dropConsole silently no-ops.
    const noCompress = await minifyPass(src, { ...prodOpts, compress: false });
    if (noCompress.includes("console.log")) {
      fail(`dropConsole must strip console.log with compress off: ${noCompress}`);
    }
    if (!noCompress.includes("#m t") || !noCompress.includes('print("ok")')) {
      fail(`dropConsole with compress off must keep print(): ${noCompress}`);
    }

    // …and it must reach the *.raw.js artifact too, which is envPass output.
    const rawProd = await envPass(src, { debug: false, prod: true }, {}, {
      dropConsole: true,
    });
    const rawDebug = await envPass(src, { debug: true, prod: false }, {}, {});
    if (rawProd.includes("console.log")) {
      fail(`dropConsole must strip console.log from prod.raw.js: ${rawProd}`);
    }
    if (!rawDebug.includes("console.log")) {
      fail(`dropConsole must not touch debug.raw.js: ${rawDebug}`);
    }
  }

  // --- all four new options false: byte-identical to omitting them --------
  {
    const src = "function tick(elapsed) { if (elapsed) { return elapsed + 1; } }";
    const withDefaults = await minifyPass(src, { ...DEFAULT_MINIFY });
    const legacyShape = { ...DEFAULT_MINIFY };
    delete legacyShape.dropConsole;
    delete legacyShape.passes;
    delete legacyShape.hoistProps;
    delete legacyShape.deviceDCE;
    const withoutKeys = await minifyPass(src, legacyShape);
    eq(withDefaults, withoutKeys, "new options at their false default are a no-op");
  }

  // --- passes / hoistProps: flow into Terser without throwing -------------
  {
    const src = "var cfg = { a: 1, b: 2 }; f(cfg.a); f(cfg.a); f(cfg.b);";
    const passesOut = await minifyPass(src, { ...DEFAULT_MINIFY, passes: true });
    const hoistOut = await minifyPass(src, { ...DEFAULT_MINIFY, hoistProps: true });
    if (!passesOut.length) fail("passes: true produced empty output");
    if (!hoistOut.length) fail("hoistProps: true produced empty output");
  }

  // --- deviceGlobalDefs: missing / malformed / partial profile ------------
  {
    const missingPath = join(tmp, "does-not-exist.json");
    const defsMissing = deviceGlobalDefs(missingPath);
    eq(Object.keys(defsMissing).length, 0, "missing profile substitutes nothing");

    const malformedPath = join(tmp, "malformed.json");
    writeFileSync(malformedPath, "{ not json");
    const defsMalformed = deviceGlobalDefs(malformedPath);
    eq(Object.keys(defsMalformed).length, 0, "unparseable profile substitutes nothing");

    const partialPath = join(tmp, "partial.json");
    writeFileSync(
      partialPath,
      JSON.stringify({ model: "S3PL-00112EU", ver: "2.0.0" }),
    );
    const defsPartial = deviceGlobalDefs(partialPath);
    if ("meta.device.gen" in defsPartial) {
      fail("meta.device.gen key must not be present at all when gen is missing");
    }
    eq(defsPartial["meta.device.model"], "S3PL-00112EU", "model substituted from partial profile");
    eq(defsPartial["meta.device.fw"], "2.0.0", "fw substituted from profile's `ver` field");

    const fullPath = join(tmp, "full.json");
    writeFileSync(
      fullPath,
      JSON.stringify({ gen: 3, model: "S3PL-00112EU", ver: "2.0.0" }),
    );
    const defsFull = deviceGlobalDefs(fullPath);
    eq(defsFull["meta.device.gen"], 3, "gen substituted as a number");
    eq(defsFull["meta.device.model"], "S3PL-00112EU", "model substituted as a string");
    eq(defsFull["meta.device.fw"], "2.0.0", "fw substituted as a string");
  }

  // --- envPass + deviceDefs: DCE actually eliminates the dead branch -------
  {
    const src =
      "if (meta.device.gen >= 3) { console.log('matter'); } else { console.log('legacy'); }";
    const withDCE = await envPass(
      src,
      { debug: false, prod: true },
      { "meta.device.gen": 3 },
    );
    if (withDCE.includes("legacy") || !withDCE.includes("matter")) {
      fail(`deviceDCE did not eliminate the dead branch: ${withDCE}`);
    }

    // Off (or profile absent): meta.device.gen must stay a bare, un-substituted
    // reference — never get fed `undefined`, which would silently delete the
    // wrong branch instead of leaving both reachable at runtime.
    const withoutDCE = await envPass(src, { debug: false, prod: true }, {});
    if (!withoutDCE.includes("meta.device.gen")) {
      fail(
        `deviceDCE off must leave meta.device.gen un-substituted, not resolve it: ${withoutDCE}`,
      );
    }
    if (!withoutDCE.includes("matter") || !withoutDCE.includes("legacy")) {
      fail(`deviceDCE off must not eliminate either branch: ${withoutDCE}`);
    }
  }

  console.log(
    "OK: dropConsole scope + no-op-when-off + passes/hoistProps + deviceDCE substitution/DCE",
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
