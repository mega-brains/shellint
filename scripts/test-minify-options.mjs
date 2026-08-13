/**
 * Assert the minify option schema (shared/minify-options.mjs) and its UI tips
 * (web/ui/option-tip.tsx) can't drift apart. OPT_TIPS stays hand-written
 * prose+JSX — deliberately not folded into the schema — so this is the seam
 * test that keeps every schema key covered by a tip and vice versa.
 * Usage: node --import tsx scripts/test-minify-options.mjs
 */
import {
  DEFAULT_MINIFY,
  MINIFY_KEYS,
  MINIFY_OPTIONS,
} from "../shared/minify-options.mjs";
import { OPT_TIPS } from "../web/ui/option-tip.tsx";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const schemaKeys = new Set(MINIFY_OPTIONS.map((o) => o.key));
const tipKeys = new Set(Object.keys(OPT_TIPS));

for (const key of schemaKeys) {
  if (!tipKeys.has(key)) {
    fail(`OPT_TIPS is missing an entry for minify option "${key}"`);
  }
}
for (const key of tipKeys) {
  if (!schemaKeys.has(key)) {
    fail(`OPT_TIPS has a stale entry "${key}" with no matching minify option`);
  }
}

if (MINIFY_KEYS.length !== MINIFY_OPTIONS.length) {
  fail("MINIFY_KEYS and MINIFY_OPTIONS length mismatch");
}
for (const key of Object.keys(DEFAULT_MINIFY)) {
  if (!schemaKeys.has(key)) {
    fail(`DEFAULT_MINIFY has key "${key}" not present in MINIFY_OPTIONS`);
  }
}

console.log("OK: minify option schema and OPT_TIPS stay in sync");
