/**
 * Fail if any source file exceeds MAX lines. This is the *only* mechanism that
 * enforces the limit — `.oxlintrc.json` deliberately leaves `max-lines` off,
 * because this scan also reaches .css and the device code oxlint ignores.
 *
 * Raw lines: blanks and comments count, since a 900-line file is hard to read
 * however it is filled.
 *
 * Scans .ts .tsx .js .mjs .mts .css under the repo (skips build/vendor dirs).
 *
 * Usage: node scripts/check-line-limit.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const MAX = 500;
const EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".mts", ".css"]);
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".tsc-out",
  ".txiki",
  ".shellint",
  ".git",
  ".idea",
  // Vendored, not authored: the txiki binaries under vendor/ and the Espruino
  // UMD bundles under web/static/vendor/.
  "vendor",
  // Fixture workspaces scripts/fixture-workspace.mjs copies per test runner,
  // plus scratch configs — generated, and every one is a copy of a file that
  // is already checked at its real path.
  ".tmp",
  // Playwright output.
  "test-results",
  "playwright-report",
  ".playwright-mcp",
  // Agent notes and plans.
  ".claude",
  // Minify benchmark inputs, not app source: they need bulk to be
  // representative, and nothing imports them. See bench/README.md.
  "bench",
]);
/**
 * Skipped only at the repo root, unlike SKIP_DIRS above, which matches a bare
 * directory name at any depth.
 *
 * The distinction is load-bearing: `site` in the set above silently exempted
 * `web/site/` — seven authored source files — along with the intended
 * `site/` build output, so nothing in the presentation site had ever been
 * measured. Anchor anything here whose name is plausible deeper in the tree.
 */
const SKIP_ROOT_DIRS = new Set([
  // scripts/build-static.mjs's build output (M17.7) — same reasoning as dist/
  // and web/dist/ above: generated, not authored.
  "site",
  // Design handoffs: annotated mockup documents plus the runtime they need
  // (`support.js`), delivered as-is by the designer. Reference material, not
  // app source — nothing imports it and it is never bundled.
  "design",
]);
// Device script authored by the user in the editor — not app source, can't
// use imports (compiles module:none/noLib) so it can't be split like the rest.
const SKIP_FILES = new Set(["scripts/main.ts"]);
// Written by `mise run probe` off whatever the device answers, so its size is
// the device's business, not ours.
const SKIP_PREFIXES = ["types/generated"];

function skipped(rel) {
  return SKIP_FILES.has(rel) || SKIP_PREFIXES.some((p) => rel.startsWith(p));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    if (dir === ROOT && SKIP_ROOT_DIRS.has(name)) continue;
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(path, out);
    } else if (st.isFile() && EXTS.has(extname(name))) {
      out.push(path);
    }
  }
  return out;
}

function lineCount(text) {
  if (text === "") return 0;
  return text.replace(/\n$/, "").split("\n").length;
}

const offenders = [];
let checked = 0;

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  if (skipped(rel)) continue;
  checked += 1;
  const n = lineCount(readFileSync(file, "utf8"));
  if (n > MAX) offenders.push({ file: rel, lines: n });
}

if (offenders.length) {
  console.error(`FAIL: ${offenders.length} file(s) exceed ${MAX} lines:`);
  for (const o of offenders.sort((a, b) => b.lines - a.lines)) {
    console.error(`  ${o.lines}\t${o.file}`);
  }
  process.exit(1);
}

console.log(`OK: ${checked} source file(s) ≤ ${MAX} lines`);
