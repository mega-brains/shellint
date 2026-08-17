import { runtime } from "#devroom/runtime";
import { DIST_DIR, SCRIPT_PATH } from "../core/paths.ts";
import { lintScriptFile } from "./lint-source.ts";
import { lintSemanticsFile } from "./lint-semantics.ts";
import { lintAdvisoriesFile, typeDeclarationFiles } from "./lint-advisories.ts";
import { lintConnected } from "./lint-connected.ts";
import { lintProbe } from "./lint-probe.ts";
import {
  fetchDeviceProfile,
  readDeviceProfile,
  type DeviceProfile,
} from "../device/device-profile.ts";
import type { Finding } from "./lint-util.ts";
import { checkBuildArtifacts } from "./dialect-check.ts";
import { analyzeScriptFile, type ScriptStats } from "../script/script-stats.ts";
import { CHECK_CATALOG, summarizeChecks, type CheckRow } from "./check-catalog.ts";
import { readProbeReport } from "../probe/probe-typings.ts";
import { previewCheckFixes, type CheckFixPreview } from "./check-fixes.ts";

const { fs } = runtime;
const { join } = runtime.path;

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
  fixes: CheckFixPreview | null;
};

export type CheckOptions = {
  /** Refresh the device profile over RPC before linting; falls back to cache. */
  connected?: boolean;
  /** Called after each real, completed check phase. */
  onProgress?: (progress: CheckProgress) => void;
};

export type CheckProgress = { done: number; total: number };

const ARTIFACTS = ["debug.raw.js", "prod.raw.js"];

export const CHECK_PROGRESS_TOTAL = CHECK_CATALOG.length;
export const CHECK_PROGRESS_STEPS = [0, 42, 44, 57, 64] as const;

function reportProgress(opts: CheckOptions, done: number): void {
  opts.onProgress?.({ done, total: CHECK_PROGRESS_TOTAL });
}

/** Warn when dist/ predates the saved source: the dialect half is then stale. */
async function artifactFindings(): Promise<{ findings: Finding[]; artifacts: string[] }> {
  const findings: Finding[] = [];
  const artifacts: string[] = [];
  for (const artifact of ARTIFACTS) {
    if (await fs.exists(join(DIST_DIR, artifact))) artifacts.push(artifact);
  }

  if (!artifacts.length) {
    findings.push({
      severity: "warn",
      rule: "artifacts-missing",
      message: "no dist/*.raw.js yet — dialect guard skipped; run Build first",
    });
    return { findings, artifacts };
  }

  const scriptMtime = (await fs.exists(SCRIPT_PATH))
    ? (await fs.stat(SCRIPT_PATH)).mtimeMs
    : 0;
  const stale: string[] = [];
  for (const artifact of artifacts) {
    if ((await fs.stat(join(DIST_DIR, artifact))).mtimeMs < scriptMtime) {
      stale.push(artifact);
    }
  }
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

  const cached = await readDeviceProfile();
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
  reportProgress(opts, CHECK_PROGRESS_STEPS[0]);
  const findings: Finding[] = [
    ...(await lintScriptFile()),
    ...(await lintSemanticsFile()),
    ...(await lintAdvisoriesFile()),
  ];
  const source = await fs.readText(SCRIPT_PATH);
  reportProgress(opts, CHECK_PROGRESS_STEPS[1]);

  const { profile, findings: profileNotes } = await resolveProfile(
    opts.connected === true,
  );
  findings.push(...profileNotes);
  reportProgress(opts, CHECK_PROGRESS_STEPS[2]);
  if (await fs.exists(SCRIPT_PATH)) {
    if (profile) findings.push(...lintConnected(source, profile));
    findings.push(...(await lintProbe(source)));
  }
  reportProgress(opts, CHECK_PROGRESS_STEPS[3]);

  const { findings: artifactNotes, artifacts } = await artifactFindings();
  findings.push(...artifactNotes);

  for (const report of await checkBuildArtifacts()) {
    for (const f of report.findings) {
      findings.push({ ...f, file: `dist/${report.file}` });
    }
  }
  reportProgress(opts, CHECK_PROGRESS_STEPS[4]);

  let stats: ScriptStats | null = null;
  try {
    stats = await analyzeScriptFile();
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
      probe: (await readProbeReport()) !== null,
      types: (await typeDeclarationFiles()).length > 0,
    }),
    artifacts,
    stats,
    fixes: previewCheckFixes(source, findings),
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
