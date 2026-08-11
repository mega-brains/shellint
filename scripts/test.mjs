/**
 * Project tests: dual Shelly build + web bundle + dialect/stats smoke.
 * Usage: node scripts/test.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    fail(`${cmd} ${args.join(" ")}\n${r.stderr || r.stdout}`);
  }
  return r;
}

run("npm", ["run", "build:shelly"]);
run("npm", ["run", "build:web"]);

for (const f of [
  "dist/debug.js",
  "dist/prod.js",
  "dist/debug.raw.js",
  "dist/prod.raw.js",
  "web/dist/app.js",
]) {
  if (!existsSync(join(ROOT, f))) fail(`missing ${f}`);
}

const same = (a, b) =>
  readFileSync(join(ROOT, a)).equals(readFileSync(join(ROOT, b)));

if (same("dist/debug.js", "dist/prod.js")) {
  fail("debug and prod min outputs identical (meta.env DCE broken?)");
}
if (same("dist/debug.raw.js", "dist/prod.raw.js")) {
  fail("debug and prod raw outputs identical (meta.env DCE broken?)");
}
if (same("dist/debug.raw.js", "dist/debug.js")) {
  fail("debug raw and min identical (minify noop?)");
}

const smoke = spawnSync(
  "node",
  [
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    `
import { checkBuildArtifacts } from "./server/dialect-check.ts";
import { analyzeScriptFile } from "./server/script-stats.ts";
import { inferChip } from "./server/device-status.ts";

const dialect = checkBuildArtifacts();
const bad = dialect.flatMap((r) => r.findings.filter((f) => f.severity === "error"));
if (bad.length) {
  console.error(JSON.stringify(bad, null, 2));
  process.exit(1);
}
const stats = analyzeScriptFile();
if (!stats.apis["Timer.set"]) throw new Error("expected Timer.set in sample stats");
if (inferChip(2, "SNSW") !== "ESP32") throw new Error("inferChip gen2");
if (inferChip(3, "S3SW") !== "ESP32-C3") throw new Error("inferChip gen3");
console.log("smoke: dialect/stats/inferChip ok");
`,
  ],
  { cwd: ROOT, encoding: "utf8" },
);
if (smoke.status !== 0) {
  fail(`server smoke\n${smoke.stderr || smoke.stdout}`);
}
process.stdout.write(smoke.stdout);

console.log("OK: shelly artifacts; web bundle; debug≠prod; raw≠min; server smoke");
