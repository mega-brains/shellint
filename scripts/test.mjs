/**
 * Project tests: dual Shelly build + web bundle + dialect/stats smoke.
 * Usage: node scripts/test.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
run("node", ["scripts/test-dialect-artifacts.mjs"]);
run("node", ["--import", "tsx", "scripts/test-dashboard.mjs"]);
run("node", ["scripts/test-tier3.mjs"]);
run("node", ["--import", "tsx", "scripts/test-logmap.mjs"]);
run("node", ["--import", "tsx", "scripts/test-typings.mjs"]);
run("node", ["--import", "tsx", "scripts/test-probe-catalog.mjs"]);
run("node", ["--import", "tsx", "scripts/test-minify-options.mjs"]);
run("node", ["scripts/test-device-minify-options.mjs"]);
run("node", ["--import", "tsx", "scripts/test-intern-strings.mjs"]);
run("node", ["scripts/test-web-assets.mjs"]);
run("node", ["--import", "tsx", "scripts/test-script-history.mjs"]);
run("node", ["--import", "tsx", "scripts/test-devices.mjs"]);
run("node", ["--import", "tsx", "scripts/test-device-scripts.mjs"]);

for (const f of [
  "dist/debug.js",
  "dist/prod.js",
  "dist/debug.raw.js",
  "dist/prod.raw.js",
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

// Unsupported globals are banned by the device tsconfig (`noLib` + `types: []`),
// not by a lint rule — and re-adding @types/node there would silently undo it.
{
  const fixture = join(ROOT, "scripts", "banned-globals.fixture.ts");
  const config = join(ROOT, "tsconfig.banned-globals.json");
  writeFileSync(
    fixture,
    [
      "var mapped = [1, 2].map(function (x: number) { return x; });",
      'var matched = /x/.test("y");',
      'var padded = "a".padStart(2, " ");',
      "var promised = new Promise(function () {});",
      "var uniq = new Set<number>();",
      'var sym = Symbol("x");',
      "",
    ].join("\n"),
  );
  writeFileSync(
    config,
    JSON.stringify({
      extends: "./tsconfig.shelly.json",
      compilerOptions: { noEmit: true },
      include: ["scripts/banned-globals.fixture.ts", "types/**/*.d.ts"],
    }),
  );
  try {
    const r = spawnSync(
      "node",
      ["node_modules/typescript/bin/tsc", "-p", "tsconfig.banned-globals.json"],
      { cwd: ROOT, encoding: "utf8" },
    );
    if (r.status === 0) {
      fail("device compile accepts Promise/Set/Symbol/RegExp/map — noLib or types:[] regressed");
    }
    for (const name of ["map", "RegExp", "padStart", "Promise", "Set", "Symbol"]) {
      if (!r.stdout.includes(name)) {
        fail(`device compile did not reject ${name}:\n${r.stdout}`);
      }
    }
  } finally {
    rmSync(fixture, { force: true });
    rmSync(config, { force: true });
  }
}

const smoke = run("node", ["--import", "tsx", "scripts/test-smoke.mjs"]);
process.stdout.write(smoke.stdout);

console.log("OK: shelly artifacts; web bundle; debug≠prod; raw≠min; server smoke");
