/**
 * Node-side harness for the M17.4 static/offline compliance check (no
 * browser, no real Worker — see the "worker" section below for how this
 * fakes just enough of one to execute the actual bundled `self.onmessage`
 * handler, the same code path a real Worker runs).
 *
 * Proves equivalence: `runCheck()` (server/lint/check.ts) run for real
 * against this repo's own scripts/main.ts + dist/*, vs. the same `runCheck`
 * run *unmodified* inside a `web/static/pipeline.worker.ts` bundle over an
 * in-memory VFS seeded with the exact same source + dist bytes. The two
 * `CheckReport`s must agree rule for rule, with one allowed difference:
 * rules whose input is deliberately absent in the static build (device
 * profile, probe report, types/*.d.ts — none of which are seeded into the
 * VFS, see server/lint/check-catalog.ts's `needs` tags) must report
 * `skipped` there, never `pass`.
 *
 * Usage: node --import tsx scripts/test-static-check.mjs
 * (requires a fresh `npm run build:shelly` — same precondition as
 * scripts/test-static-pipeline.mjs, so both reports see the same dist/*.)
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { staticEsbuildConfig } from "./static-esbuild.mjs";
import { distDir, scriptPath } from "./fixture-workspace.mjs";
import { SCRIPT_LABEL } from "../server/core/paths.ts";
import { CHECK_CATALOG } from "../server/lint/check-catalog.ts";
import {
  CHECK_PROGRESS_STEPS,
  CHECK_PROGRESS_TOTAL,
  runCheck,
} from "../server/lint/check.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = distDir();

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** Rules whose only possible verdicts in the static build are skipped/fail/warn
 * from *findings that don't need the absent input* — never a bare "pass" —
 * because the VFS deliberately carries no device profile, probe report, or
 * types/*.d.ts (M17 plan §4). Derived from the catalog rather than
 * hardcoded, so a future `needs` tag change doesn't silently go unchecked. */
const EXPECT_SKIPPED_STATIC = new Set(
  CHECK_CATALOG.filter((c) => c.needs === "profile" || c.needs === "probe" || c.needs === "types").map(
    (c) => c.rule,
  ),
);

/**
 * `check-catalog.ts`'s "inputs" group (`profile-missing`, `device-unreachable`,
 * `artifacts-missing`, `artifacts-stale`) reports on the presence of exactly
 * the inputs the two runs deliberately differ on — no `needs` tag gates them
 * because *they* are what "needs" is computed from. Whether e.g.
 * `profile-missing` fires legitimately depends on whether this repo checkout
 * happens to have a cached device profile right now, which is incidental to
 * what M17.4 proves, so these are excluded from the strict rule-for-rule
 * comparison rather than asserted one way or the other.
 */
const INPUT_GROUP_RULES = new Set(CHECK_CATALOG.filter((c) => c.group === "inputs").map((c) => c.rule));

function readDistArtifacts() {
  if (!existsSync(DIST_DIR)) fail("dist/ missing — run `npm run build:shelly` first");
  const artifacts = {};
  for (const name of readdirSync(DIST_DIR)) {
    if (!/\.(raw\.js|js|adv\.js|logmap\.json)$/.test(name)) continue;
    artifacts[name] = readFileSync(path.join(DIST_DIR, name), "utf8");
  }
  if (!artifacts["debug.raw.js"] || !artifacts["prod.raw.js"]) {
    fail("dist/{debug,prod}.raw.js missing — run `npm run build:shelly` first");
  }
  return artifacts;
}

/**
 * Bundles pipeline.worker.ts (same config as scripts/test-static-pipeline.mjs
 * and, eventually, build:static — scripts/static-esbuild.mjs is the one
 * source of truth) and runs its actual `self.onmessage` handler by faking
 * just enough of a Worker global scope for it to execute under plain Node:
 * `self` aliased to `globalThis`, and `postMessage` overridden to resolve a
 * promise instead of leaving the browser. This exercises the exact code path
 * a real Worker runs, not a reimplementation of it.
 */
async function bundleAndRunCheck(source, artifacts) {
  const outDir = mkdtempSync(path.join(tmpdir(), "shellint-static-check-"));
  try {
    const outfile = path.join(outDir, "pipeline.worker.mjs");
    const result = await esbuild.build({
      ...staticEsbuildConfig(),
      entryPoints: [path.join(ROOT, "web", "static", "pipeline.worker.ts")],
      outfile,
      minify: false,
      logLevel: "silent",
    });
    if (result.warnings.length) {
      fail(`bundling pipeline.worker.ts produced warnings:\n${result.warnings.map((w) => w.text).join("\n")}`);
    }

    const previousSelf = globalThis.self;
    const previousPost = globalThis.postMessage;
    let deliver = null;
    const messages = [];
    globalThis.self = globalThis;
    globalThis.postMessage = (msg) => {
      messages.push(msg);
      if (msg.type === "check" && deliver) {
        const resolve = deliver;
        deliver = null;
        resolve(msg);
      }
    };
    try {
      await import(pathToFileURL(outfile).href);
      const response = await new Promise((resolve) => {
        deliver = resolve;
        globalThis.onmessage({ data: { type: "check", id: "static-check-test", source, artifacts } });
      });
      if (!response.ok) fail(`static check request failed: ${response.error}`);
      return {
        progress: messages.filter((msg) => msg.type === "check-progress"),
        report: response.result,
      };
    } finally {
      globalThis.self = previousSelf;
      globalThis.postMessage = previousPost;
      globalThis.onmessage = undefined;
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function checksByRule(report) {
  return new Map(report.checks.map((c) => [c.rule, c]));
}

function assertEquivalent(serverReport, staticReport) {
  const serverByRule = checksByRule(serverReport);
  const staticByRule = checksByRule(staticReport);
  assert.equal(staticByRule.size, serverByRule.size, "check catalogs differ in size between the two runs");

  const skippedInStatic = [];
  for (const [rule, serverRow] of serverByRule) {
    const staticRow = staticByRule.get(rule);
    if (!staticRow) fail(`static report is missing rule "${rule}"`);

    if (EXPECT_SKIPPED_STATIC.has(rule)) {
      if (staticRow.status !== "skipped") {
        fail(
          `"${rule}" needs an input the static VFS deliberately omits (${staticRow.status}, expected "skipped")`,
        );
      }
      skippedInStatic.push(rule);
      // Not asserting anything about serverRow here: whether *this* repo
      // checkout currently has a cached profile/probe/types is incidental to
      // what M17.4 is proving.
      continue;
    }

    if (INPUT_GROUP_RULES.has(rule)) continue; // see INPUT_GROUP_RULES above

    assert.equal(
      staticRow.status,
      serverRow.status,
      `"${rule}" status diverged: server=${serverRow.status} static=${staticRow.status}`,
    );
    assert.equal(
      staticRow.count,
      serverRow.count,
      `"${rule}" finding count diverged: server=${serverRow.count} static=${staticRow.count}`,
    );
  }

  // Every skipped-in-static rule must actually be one of the expected ones —
  // and never "pass" masquerading as something else.
  for (const row of staticReport.checks) {
    if (row.status === "skipped" && !EXPECT_SKIPPED_STATIC.has(row.rule)) {
      fail(`"${row.rule}" is unexpectedly skipped in the static report`);
    }
  }

  // Full findings equality (message text, not just counts) for every rule
  // that isn't allowed to differ — catches a subtler divergence (e.g. a line
  // number) that a bare count match would miss.
  const nonExempt = (f) => !EXPECT_SKIPPED_STATIC.has(f.rule) && !INPUT_GROUP_RULES.has(f.rule);
  // The static build always names the script "scripts/main.ts" (a browser has
  // no repo path); server names whatever SHELLINT_SCRIPT points at. Same
  // file, two labels — compared under one name so the fixture workspace
  // doesn't read as a divergence.
  const label = (f) =>
    f.file === SCRIPT_LABEL || f.file === "scripts/main.ts" ? "<script>" : (f.file ?? "");
  const normalize = (findings) =>
    findings
      .filter(nonExempt)
      .map((f) => `${f.severity}|${f.rule}|${label(f)}|${f.line ?? ""}|${f.message}`)
      .sort();
  assert.deepStrictEqual(
    normalize(staticReport.findings),
    normalize(serverReport.findings),
    "findings text diverged for a rule that should behave identically offline",
  );

  assert.deepStrictEqual(serverReport.stats, staticReport.stats, "script stats diverged");

  return skippedInStatic.sort();
}

const source = readFileSync(scriptPath(), "utf8");
const artifacts = readDistArtifacts();

const serverReport = await runCheck({ connected: false });
const staticResult = await bundleAndRunCheck(source, artifacts);
assert.deepStrictEqual(
  staticResult.progress.map((event) => event.progress.done),
  CHECK_PROGRESS_STEPS,
  "static Check progress milestones changed",
);
assert.ok(
  staticResult.progress.every((event) => event.progress.total === CHECK_PROGRESS_TOTAL),
  "static Check progress total changed",
);
const staticReport = staticResult.report;

const skipped = assertEquivalent(serverReport, staticReport);

console.log(
  `OK: static check (VFS + node-shims) agrees with the server check rule for rule; ` +
    `${skipped.length} rule(s) skipped offline (no device profile/probe/types.d.ts seeded): ${skipped.join(", ")}`,
);
