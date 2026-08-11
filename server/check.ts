import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DIST_DIR, SCRIPT_PATH } from "./paths.ts";
import { lintScriptFile, type Finding } from "./lint-source.ts";
import { checkBuildArtifacts } from "./dialect-check.ts";
import { analyzeScriptFile, type ScriptStats } from "./script-stats.ts";

export type CheckReport = {
  ok: boolean;
  findings: Finding[];
  counts: { errors: number; warnings: number };
  artifacts: string[];
  stats: ScriptStats | null;
};

const ARTIFACTS = ["debug.raw.js", "prod.raw.js"];

/** Warn when dist/ predates the saved source: the dialect half is then stale. */
function artifactFindings(): { findings: Finding[]; artifacts: string[] } {
  const findings: Finding[] = [];
  const artifacts = ARTIFACTS.filter((f) => existsSync(join(DIST_DIR, f)));

  if (!artifacts.length) {
    findings.push({
      severity: "warn",
      rule: "artifacts-missing",
      message: "no dist/*.raw.js yet — dialect guard skipped; run Build first",
    });
    return { findings, artifacts };
  }

  const scriptMtime = existsSync(SCRIPT_PATH)
    ? statSync(SCRIPT_PATH).mtimeMs
    : 0;
  const stale = artifacts.filter(
    (f) => statSync(join(DIST_DIR, f)).mtimeMs < scriptMtime,
  );
  if (stale.length) {
    findings.push({
      severity: "warn",
      rule: "artifacts-stale",
      message: `${stale.join(", ")} older than scripts/main.ts — dialect findings may be out of date`,
    });
  }
  return { findings, artifacts };
}

/**
 * Static Shelly/Espruino compliance for the saved script.
 * Source lint (Tier 1–2) always runs; the dialect guard runs over whatever
 * build artifacts exist, so Check works with no device and no prior build.
 */
export function runCheck(): CheckReport {
  const findings: Finding[] = [...lintScriptFile()];

  const { findings: artifactNotes, artifacts } = artifactFindings();
  findings.push(...artifactNotes);

  for (const report of checkBuildArtifacts()) {
    for (const f of report.findings) {
      findings.push({ ...f, file: `dist/${report.file}` });
    }
  }

  let stats: ScriptStats | null = null;
  try {
    stats = analyzeScriptFile();
  } catch {
    /* stats are best-effort */
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  return {
    ok: errors === 0,
    findings,
    counts: { errors, warnings: findings.length - errors },
    artifacts,
    stats,
  };
}
