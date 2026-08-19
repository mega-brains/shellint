/**
 * Bundle the Preact + CodeMirror SPA into web/dist/.
 *
 *   app.js      minified ESM bundle (+ .br/.gz siblings)
 *   styles.css  feature CSS, bundled and minified (+ .br/.gz)
 *   app.js.map  dev builds only — 2.4 MB, omitted from --prod
 *
 * Usage: node scripts/build-web.mjs [--prod] [--force]
 *
 * Rebuilds are skipped when nothing that fed the last bundle has changed. The
 * input list is esbuild's own metafile, not a glob — a glob has to guess which
 * of web/, shared/, types/ and node_modules/ the graph actually reached, and
 * guessing low ships a stale bundle. `--force` (or a missing/mismatched
 * `.build-meta.json`) always rebuilds. This matters most where the same bundle
 * is built several times in a row for no new reason: `beforeCommit` builds it
 * for build:gate and again for each of the two e2e webServers.
 */
import * as esbuild from "esbuild";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "web", "dist");
const prod = process.argv.includes("--prod");
const force = process.argv.includes("--force");
const stampFile = join(distDir, ".build-meta.json");

mkdirSync(distDir, { recursive: true });

/** Newest mtime among `files`, or Infinity if any of them is gone. */
function newestMtime(files) {
  let newest = 0;
  for (const file of files) {
    if (!existsSync(file)) return Infinity;
    newest = Math.max(newest, statSync(file).mtimeMs);
  }
  return newest;
}

/** True when the last build's inputs are all older than its outputs. */
function upToDate() {
  if (force || !existsSync(stampFile)) return false;
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(stampFile, "utf8"));
  } catch {
    return false;
  }
  // A dev bundle carries a sourcemap a --prod run must drop, and vice versa.
  if (stamp.prod !== prod || !Array.isArray(stamp.inputs)) return false;
  const outputs = [
    join(distDir, "app.js"),
    join(distDir, "styles.css"),
    join(distDir, "api-docs.json"),
  ];
  for (const out of outputs) {
    if (!existsSync(out) || !existsSync(`${out}.br`) || !existsSync(`${out}.gz`)) {
      return false;
    }
  }
  const oldestOutput = Math.min(...outputs.map((f) => statSync(f).mtimeMs));
  return newestMtime(stamp.inputs.map((p) => join(root, p))) <= oldestOutput;
}

if (upToDate()) {
  console.log("web/dist up to date — skipping bundle (--force to rebuild)");
  process.exit(0);
}

/** Write .br + .gz siblings so the server can serve them precompressed. */
function precompress(file) {
  const source = readFileSync(file);
  const br = brotliCompressSync(source, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const gz = gzipSync(source, { level: 9 });
  writeFileSync(`${file}.br`, br);
  writeFileSync(`${file}.gz`, gz);
  return { raw: source.length, br: br.length, gz: gz.length };
}

const jsOut = join(distDir, "app.js");
const jsResult = await esbuild.build({
  entryPoints: [join(root, "web", "shell", "main.tsx")],
  bundle: true,
  outfile: jsOut,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  sourcemap: !prod,
  jsx: "automatic",
  jsxImportSource: "preact",
  logLevel: "info",
  metafile: true,
});

// A stale map from an earlier dev build would not match minified output.
if (prod) rmSync(`${jsOut}.map`, { force: true });

const cssOut = join(distDir, "styles.css");
const cssResult = await esbuild.build({
  entryPoints: [join(root, "web", "styles.entry.css")],
  bundle: true,
  outfile: cssOut,
  minify: true,
  logLevel: "info",
  metafile: true,
});

// Hover docs are fetched at runtime, not bundled — stage them next to the
// other assets so they get the same precompression treatment.
const docsOut = join(distDir, "api-docs.json");
copyFileSync(join(root, "types", "api-docs.json"), docsOut);

for (const file of [jsOut, cssOut, docsOut]) {
  const { raw, br, gz } = precompress(file);
  const name = file.slice(root.length + 1);
  console.log(`${name}  ${raw} B  (br ${br} · gz ${gz})`);
}

// Written last, so an interrupted build leaves no stamp claiming freshness.
// `types/api-docs.json` is copied, not bundled, so it is not in either
// metafile and has to be listed by hand.
writeFileSync(
  stampFile,
  JSON.stringify({
    prod,
    inputs: [
      ...new Set([
        ...Object.keys(jsResult.metafile.inputs),
        ...Object.keys(cssResult.metafile.inputs),
        "types/api-docs.json",
      ]),
    ],
  }),
);
