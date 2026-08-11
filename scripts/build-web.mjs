/**
 * Bundle CodeMirror SPA into web/dist/app.js
 * Usage: node scripts/build-web.mjs
 */
import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "web", "dist", "app.js");

mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "web", "main.ts")],
  bundle: true,
  outfile,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  sourcemap: true,
  logLevel: "info",
});

console.log(`web bundle → ${outfile}`);
