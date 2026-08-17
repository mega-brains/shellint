/**
 * Project tests: dual Shelly build + web bundle + dialect/stats smoke.
 * Usage: node --import tsx scripts/test.mjs [name…] [--isolated]
 *
 * Every test module is a top-level script that throws (or `process.exit(1)`s)
 * on failure, so running one is just importing it. They are imported into
 * *this* process rather than spawned: `node --import tsx` costs ~750 ms of
 * transpile before a single line of test code runs, and paying that 14 times
 * was ~7.5 s of the suite's ~9.9 s. Same process, same order, same on-disk
 * effects — the modules that mutate repo files (devroom.json, scripts/main.ts,
 * .devroom/) already restore in a `finally`, which they had to do under
 * spawning too.
 *
 * `--isolated` restores the old process-per-test behaviour. Reach for it when
 * a failure looks like cross-test interference: if a test passes isolated and
 * fails in-process, the two runs differ only in shared module state.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { useFixtureWorkspace } from "./fixture-workspace.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Before anything else — including the builds below and every `await import`
// further down, since server/core/paths.ts reads the env at module load: the
// suite compiles fixtures/device/main.ts in a scratch workspace, never the
// user's scripts/main.ts, and writes its artifacts outside dist/.
const { dist: DIST } = useFixtureWorkspace("test");

const argv = process.argv.slice(2);
const isolated = argv.includes("--isolated");
const filters = argv.filter((a) => !a.startsWith("--"));

/** Order is load-bearing: artifact readers run after the builds that write dist/. */
const TESTS = [
  // Parity first: both compare against the dist/ this file just built, before
  // any later module rewrites devroom.json or scripts/main.ts underneath them.
  "test-transpile-parity",
  "test-pipeline-parity",
  "test-static-pipeline",
  "test-static-check",
  "test-local-api",
  "test-static-bundle",
  "test-dialect-artifacts",
  "test-dashboard",
  "test-tier3",
  "test-logmap",
  "test-typings",
  "test-probe-catalog",
  "test-minify-options",
  "test-device-minify-options",
  "test-intern-strings",
  "test-web-assets",
  "test-script-history",
  "test-probe-store",
  "test-probe-eco",
  "test-devices",
  "test-device-scripts",
  "test-deploy-gate",
  "test-lint-memory",
  "test-check-stream",
  "test-smoke",
];

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

/** The two builds share no inputs and no outputs, so they overlap for free. */
function runParallel(jobs) {
  return Promise.all(
    jobs.map(
      ([cmd, args]) =>
        new Promise((resolve) => {
          const child = spawn(cmd, args, {
            cwd: ROOT,
            encoding: "utf8",
            shell: process.platform === "win32",
          });
          let out = "";
          child.stdout.on("data", (d) => (out += d));
          child.stderr.on("data", (d) => (out += d));
          child.on("close", (status) => {
            if (status !== 0) fail(`${cmd} ${args.join(" ")}\n${out}`);
            resolve();
          });
        }),
    ),
  );
}

// build:static is self-contained (it runs gen-api-docs and bundles its own CSS,
// reading nothing out of web/dist), so it overlaps with the other two for free
// — and running it here is what lets test-static-bundle assert against a real
// site/ under a bare `npm run test`, not only under beforeCommit.
await runParallel([
  ["npm", ["run", "build:shelly"]],
  ["npm", ["run", "build:web"]],
  ["npm", ["run", "build:static"]],
]);

const selected = TESTS.filter((t) => !filters.length || filters.some((f) => t.includes(f)));
if (!selected.length) fail(`no test matched ${filters.join(", ")}`);

for (const name of selected) {
  if (isolated) {
    run("node", ["--import", "tsx", `scripts/${name}.mjs`]);
  } else {
    await import(`./${name}.mjs`);
  }
}

if (filters.length) {
  console.log(`OK: ${selected.length} test module(s) matching ${filters.join(", ")}`);
  process.exit(0);
}

for (const f of ["debug.js", "prod.js", "debug.raw.js", "prod.raw.js"]) {
  if (!existsSync(join(DIST, f))) fail(`missing ${f} in ${DIST}`);
}

const same = (a, b) => readFileSync(join(DIST, a)).equals(readFileSync(join(DIST, b)));

if (same("debug.js", "prod.js")) {
  fail("debug and prod min outputs identical (meta.env DCE broken?)");
}
if (same("debug.raw.js", "prod.raw.js")) {
  fail("debug and prod raw outputs identical (meta.env DCE broken?)");
}
if (same("debug.raw.js", "debug.js")) {
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
      extends: "./tsconfig.shelly.base.json",
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

console.log("OK: shelly artifacts; web bundle; debug≠prod; raw≠min; server smoke");
