/**
 * Assert the post-compile dialect guard (`checkBuildArtifacts`,
 * server/lint/dialect-check.ts) actually covers every artifact that ships to the
 * device — dist/{mode}.raw.js *and* dist/{mode}.js *and* dist/{mode}.adv.js —
 * not just the pre-Terser raw source. Tier 3 is best-effort, so its coverage
 * is only asserted when the artifact exists.
 *
 * Usage: node scripts/test-dialect-artifacts.mjs  (expects a prior `npm run build:shelly`)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkBuildArtifacts } from "../server/lint/dialect-check.ts";
import { distDir } from "./fixture-workspace.mjs";


function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const reports = await checkBuildArtifacts();
const byFile = new Map(reports.map((r) => [r.file, r]));

for (const mode of ["debug", "prod"]) {
  const raw = `${mode}.raw.js`;
  const min = `${mode}.js`;
  const adv = `${mode}.adv.js`;

  if (!byFile.has(raw)) fail(`checkBuildArtifacts did not report ${raw}`);
  if (!byFile.has(min)) fail(`checkBuildArtifacts did not report ${min}`);
  if (existsSync(join(distDir(), adv)) && !byFile.has(adv)) {
    fail(`checkBuildArtifacts did not report ${adv} though dist/${adv} exists`);
  }

  for (const name of [raw, min, adv]) {
    const report = byFile.get(name);
    if (!report) continue;
    const errors = report.findings.filter((f) => f.severity === "error");
    if (errors.length) {
      fail(`${name} has dialect errors:\n${JSON.stringify(errors, null, 2)}`);
    }
  }
}

console.log("OK: dialect guard clean on raw/min/adv artifacts for debug + prod");
