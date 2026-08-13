/**
 * Fail if any source file exceeds MAX lines.
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
  ".devroom",
  ".git",
  ".idea",
  // Minify benchmark inputs, not app source: they need bulk to be
  // representative, and nothing imports them. See bench/README.md.
  "bench",
]);
// Device script authored by the user in the editor — not app source, can't
// use imports (compiles module:none/noLib) so it can't be split like the rest.
const SKIP_FILES = new Set(["scripts/main.ts"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    // Also skip web/dist even if named oddly nested
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "dist") continue;
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

const files = walk(ROOT);
const offenders = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  if (SKIP_FILES.has(rel)) continue;
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

console.log(`OK: ${files.length} source file(s) ≤ ${MAX} lines`);
