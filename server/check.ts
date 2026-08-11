import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DIST_DIR, SCRIPT_PATH } from "./paths.ts";
import { lintScriptFile } from "./lint-source.ts";
import { lintSemanticsFile } from "./lint-semantics.ts";
import { lintAdvisoriesFile } from "./lint-advisories.ts";
import { lintConnected } from "./lint-connected.ts";
import { lintProbe } from "./lint-probe.ts";
import {
  fetchDeviceProfile,
  readDeviceProfile,
  type DeviceProfile,
} from "./device-profile.ts";
import type { Finding } from "./lint-util.ts";
import { checkBuildArtifacts } from "./dialect-check.ts";
import { analyzeScriptFile, type ScriptStats } from "./script-stats.ts";
import { summarizeChecks, type CheckRow } from "./check-catalog.ts";

export type CheckProfileInfo = {
  source: "live" | "cache";
  at: string;
  deviceIp: string;
  model: string | null;
  gen: number | null;
  ver: string | null;
};

export type CheckReport = {
  ok: boolean;
  findings: Finding[];
  counts: { errors: number; warnings: number };
  /** Every catalogued check with its verdict, findings or not. */
  checks: CheckRow[];
  artifacts: string[];
  stats: ScriptStats | null;
  profile: CheckProfileInfo | null;
};

export type CheckOptions = {
  /** Refresh the device profile over RPC before linting; falls back to cache. */
  connected?: boolean;
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
 * The device profile is refreshed only when the caller says the device is
 * reachable, so an offline Check never waits on an RPC timeout. A cached
 * profile still drives Tier 4, flagged as such.
 */
async function resolveProfile(
  connected: boolean,
): Promise<{ profile: DeviceProfile | null; findings: Finding[] }> {
  const findings: Finding[] = [];
  if (connected) {
    try {
      const profile = await fetchDeviceProfile();
      return { profile, findings };
    } catch (e) {
      findings.push({
        severity: "warn",
        rule: "device-unreachable",
        message: `could not read the device profile (${e instanceof Error ? e.message : String(e)}) — falling back to the cached one`,
      });
    }
  }

  const cached = readDeviceProfile();
  if (!cached) {
    findings.push({
      severity: "warn",
      rule: "profile-missing",
      message:
        "no device profile cached — connected lint (unknown RPC methods, missing components, firmware capabilities) is skipped",
    });
  }
  return { profile: cached, findings };
}

/**
 * Static Shelly/Espruino compliance for the saved script.
 * Source lint (Tier 1–3 + Tier 5 advisories) always runs; the dialect guard
 * runs over whatever build artifacts exist, so Check works with no device and
 * no prior build. Tier 4 additionally needs a device profile, live or cached.
 */
export async function runCheck(opts: CheckOptions = {}): Promise<CheckReport> {
  const findings: Finding[] = [
    ...lintScriptFile(),
    ...lintSemanticsFile(),
    ...lintAdvisoriesFile(),
  ];

  const { profile, findings: profileNotes } = await resolveProfile(
    opts.connected === true,
  );
  findings.push(...profileNotes);
  if (existsSync(SCRIPT_PATH)) {
    const source = readFileSync(SCRIPT_PATH, "utf8");
    if (profile) findings.push(...lintConnected(source, profile));
    findings.push(...lintProbe(source));
  }

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
    checks: summarizeChecks(findings, {
      profile: profile !== null,
      artifacts,
    }),
    artifacts,
    stats,
    profile: profile
      ? {
          source: opts.connected && !profileNotes.length ? "live" : "cache",
          at: profile.at,
          deviceIp: profile.deviceIp,
          model: profile.model,
          gen: profile.gen,
          ver: profile.ver,
        }
      : null,
  };
}
