/**
 * Bundle the Preact + CodeMirror SPA into web/dist/.
 *
 *   app.js      minified ESM bundle (+ .br/.gz siblings)
 *   styles.css  the ten web/*.css files, bundled and minified (+ .br/.gz)
 *   app.js.map  dev builds only — 2.4 MB, omitted from --prod
 *
 * Usage: node scripts/build-web.mjs [--prod]
 */
import * as esbuild from "esbuild";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "web", "dist");
const prod = process.argv.includes("--prod");

mkdirSync(distDir, { recursive: true });

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
await esbuild.build({
  entryPoints: [join(root, "web", "main.tsx")],
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
});

// A stale map from an earlier dev build would not match minified output.
if (prod) rmSync(`${jsOut}.map`, { force: true });

const cssOut = join(distDir, "styles.css");
await esbuild.build({
  entryPoints: [join(root, "web", "styles.entry.css")],
  bundle: true,
  outfile: cssOut,
  minify: true,
  logLevel: "info",
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
