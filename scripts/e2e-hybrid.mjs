/**
 * Hybrid e2e runner: Lightpanda for what it can host, Chromium for the rest,
 * both at once.
 *
 *   1. Build, then start an app server on its own port + fixture workspace for
 *      the Lightpanda pass, plus the shared static preview.
 *   2. Start N Lightpanda browsers, one per shard — Lightpanda serves a single
 *      browser context at a time, so shards cannot share one.
 *   3. In parallel: N `--shard=i/N` Lightpanda processes over everything not
 *      tagged `@layout`/`@browser-api`, AND one Chromium process over exactly
 *      those tags. Disjoint sets, separate app servers, so neither can disturb
 *      the other — which matters, because a Build on a shared server adds
 *      artifact chips and moves the layout under the design baselines' masks.
 *   4. Anything that failed on Lightpanda is re-run on Chromium, and only that
 *      verdict counts.
 *
 * Every test therefore runs on the fastest browser that can host it, and a
 * Lightpanda failure is never the answer — it only promotes that test. That is
 * the point: Lightpanda is beta, so a failure there is at least as likely to be
 * a browser gap as a real defect.
 *
 * Measured verdict on an 8-thread / 4-perf-core M-series mac, so nobody has to
 * re-derive it: this is SLOWER than plain `npm run test:e2e`, 30s against 24s.
 * The structure cannot win here. Lightpanda can host 11 of the 31 tests and
 * they are the cheap ones; Chromium's residual 20 already costs 16.6s of the
 * 23.9s full run, and overlapping the two passes oversubscribes the cores. It
 * would pay off on a box where Chromium cannot parallelise (single-CPU CI), or
 * if the `@layout`/`@browser-api` share ever shrinks a lot.
 *
 * Usage: node scripts/e2e-hybrid.mjs [--shards=N]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Not 8789: that is the Chromium config's, and the two passes overlap. */
const APP_PORT = 8790;
const STATIC_PORT = 8788;
const CDP_BASE = 9222;
/** Its own workspace too — the Chromium pass writes to `.tmp/e2e`. */
const FIXTURE_ENV = {
  SHELLINT_SCRIPT: ".tmp/e2e-lp/main.ts",
  SHELLINT_DIST: ".tmp/e2e-lp/dist",
};
/** Kept in step with `grepInvert` in e2e/playwright.lightpanda.config.ts. */
const CHROMIUM_ONLY = "@layout|@browser-api";

const shards = Number(
  process.argv.find((a) => a.startsWith("--shards="))?.slice(9) ?? 2,
);
if (!Number.isInteger(shards) || shards < 1) {
  console.error("FAIL: --shards must be a positive integer");
  process.exit(1);
}

const children = [];
/** Spawn a long-lived process and remember it for teardown. */
function bg(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}

function run(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

/** Poll `url` until it answers or the budget runs out. */
async function waitFor(url, label, ms = 120_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  children.length = 0;
}
process.on("exit", shutdown);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown();
    process.exit(130);
  });
}

/** Titles Playwright can match with --grep, from a JSON reporter file. */
function failedTitles(reportPath) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const failures = [];
  const walk = (suite) => {
    for (const child of suite.suites ?? []) walk(child);
    for (const spec of suite.specs ?? []) {
      const bad = spec.tests?.some((t) =>
        t.results?.some((r) => r.status !== "passed" && r.status !== "skipped"),
      );
      if (bad) failures.push(spec.title);
    }
  };
  for (const suite of report.suites ?? []) walk(suite);
  return failures;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

// ---------------------------------------------------------------- step 1
console.log("[hybrid] building fixture + web + static");
for (const [cmd, args] of [
  ["node", ["scripts/build-fixture.mjs", "e2e-lp"]],
  ["npm", ["run", "build:web"]],
  ["npm", ["run", "build:static"]],
]) {
  const { code, out } = await run(cmd, args);
  if (code !== 0) {
    console.error(out);
    process.exit(1);
  }
}

console.log(`[hybrid] starting app servers (${since()})`);
bg("node", ["--import", "tsx", "server/index.ts"], {
  ...FIXTURE_ENV,
  SHELLINT_PORT: String(APP_PORT),
});
bg("npm", ["run", "preview:static", "--", "--port", String(STATIC_PORT)]);
await waitFor(`http://127.0.0.1:${APP_PORT}/`, "app server");
await waitFor(`http://127.0.0.1:${STATIC_PORT}/`, "static preview");

// ---------------------------------------------------------------- step 2
console.log(`[hybrid] starting ${shards} lightpanda browser(s) (${since()})`);
const install = await run("node", ["scripts/install-lightpanda.mjs"]);
if (install.code !== 0) {
  console.error(install.out);
  process.exit(1);
}
const endpoints = [];
for (let i = 0; i < shards; i++) {
  const port = CDP_BASE + i;
  bg("./.tools/lightpanda", [
    "serve",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ]);
  endpoints.push(`ws://127.0.0.1:${port}/`);
}
await Promise.all(
  endpoints.map((_, i) =>
    waitFor(`http://127.0.0.1:${CDP_BASE + i}/json/version`, `lightpanda ${i}`),
  ),
);

// ---------------------------------------------------------------- step 3
const reportDir = mkdtempSync(join(tmpdir(), "e2e-hybrid-"));
console.log(
  `[hybrid] lightpanda (${shards} shard(s)) + chromium, in parallel (${since()})`,
);

const lightpandaPass = Promise.all(
  endpoints.map((endpoint, i) => {
    const reportPath = join(reportDir, `shard-${i}.json`);
    return run(
      "npx",
      [
        "playwright",
        "test",
        "-c",
        "e2e/playwright.lightpanda.config.ts",
        `--shard=${i + 1}/${shards}`,
        "--reporter=json",
      ],
      {
        LIGHTPANDA_CDP: endpoint,
        LIGHTPANDA_APP_PORT: String(APP_PORT),
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
        // Per shard, or they clobber each other's output directory.
        PLAYWRIGHT_HTML_REPORT: join(reportDir, `html-${i}`),
      },
    ).then(({ out }) => ({ reportPath, out }));
  }),
);

/** Chromium over a grep, with its own webServer from playwright.config.ts. */
const chromiumPass = (grep) =>
  run("npx", [
    "playwright",
    "test",
    "-c",
    "e2e/playwright.config.ts",
    "--grep",
    grep,
  ]);

const [passes, tagged] = await Promise.all([
  lightpandaPass,
  chromiumPass(CHROMIUM_ONLY),
]);

const promoted = [];
for (const { reportPath, out } of passes) {
  try {
    promoted.push(...failedTitles(reportPath));
  } catch {
    // A shard that died before writing a report says nothing about which of
    // its tests failed, so its whole slice has to be re-run on Chromium.
    console.error(out.split("\n").slice(-15).join("\n"));
    console.error("[hybrid] a lightpanda shard produced no report — see above");
    promoted.length = 0;
    break;
  }
}

const lightpandaRan = passes.reduce((n, { reportPath }) => {
  try {
    const r = JSON.parse(readFileSync(reportPath, "utf8"));
    return n + (r.stats?.expected ?? 0) + (r.stats?.unexpected ?? 0);
  } catch {
    return n;
  }
}, 0);

console.log(`[hybrid] chromium (@layout/@browser-api):`);
console.log(tagged.out.trimEnd());
console.log(
  `[hybrid] lightpanda: ${lightpandaRan} ran, ${promoted.length} promoted (${since()})`,
);
for (const title of promoted) console.log(`[hybrid]   ↑ ${title}`);

// ---------------------------------------------------------------- step 4
let promotedCode = 0;
if (promoted.length) {
  // Serial by necessity: which tests to re-run is only known once every shard
  // has reported.
  console.log(`[hybrid] chromium re-run of promoted tests (${since()})`);
  const rerun = await chromiumPass(promoted.map(escape).join("|"));
  console.log(rerun.out.trimEnd());
  promotedCode = rerun.code;
}

const failed = tagged.code !== 0 || promotedCode !== 0;

shutdown();
rmSync(reportDir, { recursive: true, force: true });
console.log(`[hybrid] done in ${since()}`);
process.exit(failed ? 1 : 0);
