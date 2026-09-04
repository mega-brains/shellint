/**
 * Owns `.shellint/devices/<id>/probes/<verKey>.json` — one probe capture per
 * firmware, kept forever (M16 §2.2: an OTA must not silently overwrite the
 * previous firmware's answers). Also answers "is a probe required", the one
 * definition the deploy gate, the routes, and the UI banner all share.
 *
 * Everything else calls into this module; no other file builds a capture path.
 */
import { runtime } from "#shellint/runtime";
import { devicePaths } from "../core/paths.ts";
import { getDevice } from "../device/devices.ts";
import { isAbsent, isPresent, probeEntries } from "./probe-typings.ts";
import type { ProbeReport } from "./probe.ts";

const { fs } = runtime;
const { join } = runtime.path;

const MAX_VER_KEY = 40;
const SAFE_VER_KEY = /^[A-Za-z0-9._-]+$/;

/**
 * `ver` reaches the filesystem, so it is sanitized (only `[A-Za-z0-9._-]`
 * survive) and capped — a malformed device answer must not produce a
 * pathological name. `"."`/`".."` are rejected outright even though the
 * sanitizer alone already strips path separators, since a bare `".."` is a
 * legal *result* of sanitizing something like the literal string `".."`.
 */
export function verKeyOf(ver: string | null | undefined): string {
  if (!ver) return "unknown";
  const sanitized = ver.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, MAX_VER_KEY);
  return sanitized && sanitized !== "." && sanitized !== ".." ? sanitized : "unknown";
}

function assertSafeVerKey(verKey: string): void {
  if (!SAFE_VER_KEY.test(verKey) || verKey === "." || verKey === "..") {
    throw new Error(`invalid capture id "${verKey}"`);
  }
}

export type CaptureMeta = {
  ver: string | null;
  verKey: string;
  at: string;
  path: string;
  present: number;
  absent: number;
  unevaluated: number;
};

async function readCapture(path: string): Promise<ProbeReport | null> {
  if (!(await fs.exists(path))) return null;
  try {
    const parsed = JSON.parse(await fs.readText(path)) as ProbeReport;
    return Array.isArray(parsed?.results) ? parsed : null;
  } catch {
    return null;
  }
}

function countVerdicts(report: ProbeReport): { present: number; absent: number; unevaluated: number } {
  const entries = probeEntries(report);
  return {
    present: entries.filter(isPresent).length,
    absent: entries.filter(isAbsent).length,
    unevaluated: entries.filter((entry) => entry.unevaluated).length,
  };
}

/**
 * One-way, automatic, idempotent (M16 §3.4): adopts the legacy single-capture
 * `probe.json` into `probes/<verKey>.json` the first time this device's
 * captures are read. `verKey` comes from (a) the capture's own `ver`, else
 * (b) the cached `profile.json`'s `ver` when its `deviceIp` matches the
 * capture's, else (c) `"unknown"`. The legacy file is left in place.
 */
async function migrateLegacy(deviceId: string): Promise<void> {
  const paths = devicePaths(deviceId);
  if (await fs.exists(paths.probesDir)) return;
  const legacy = await readCapture(paths.probe);
  if (!legacy) return;

  let verKey: string;
  if (typeof legacy.ver === "string" && legacy.ver) {
    verKey = verKeyOf(legacy.ver);
  } else if (await fs.exists(paths.profile)) {
    try {
      const profile = JSON.parse(await fs.readText(paths.profile)) as {
        deviceIp?: string;
        ver?: string;
      };
      verKey = profile.deviceIp === legacy.deviceIp && profile.ver ? verKeyOf(profile.ver) : "unknown";
    } catch {
      verKey = "unknown";
    }
  } else {
    verKey = "unknown";
  }

  await fs.mkdir(paths.probesDir, { recursive: true });
  const dest = join(paths.probesDir, `${verKey}.json`);
  if (!(await fs.exists(dest))) {
    await fs.writeText(dest, JSON.stringify(legacy, null, 2) + "\n");
  }
}

/** Newest first. Runs the §3.4 migration first, so a never-yet-read device
 * with only a legacy `probe.json` still shows one capture. */
export async function listCaptures(deviceId: string): Promise<CaptureMeta[]> {
  await migrateLegacy(deviceId);
  const dir = devicePaths(deviceId).probesDir;
  if (!(await fs.exists(dir))) return [];
  const metas: CaptureMeta[] = [];
  for (const entry of await fs.readDir(dir)) {
    const name = entry.name;
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    const report = await readCapture(path);
    if (!report) continue;
    const { present, absent, unevaluated } = countVerdicts(report);
    metas.push({
      ver: typeof report.ver === "string" ? report.ver : null,
      verKey: name.slice(0, -".json".length),
      at: report.at ?? "",
      path,
      present,
      absent,
      unevaluated,
    });
  }
  metas.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return metas;
}

/** mkdir -p + atomic write. Partial captures never replace fuller ones. */
export async function writeCapture(
  deviceId: string,
  report: ProbeReport,
): Promise<{ path: string; kept: boolean }> {
  const dir = devicePaths(deviceId).probesDir;
  await fs.mkdir(dir, { recursive: true });
  const path = join(dir, `${verKeyOf(report.ver)}.json`);
  const existing = await readCapture(path);
  const existingUnevaluated = existing ? countVerdicts(existing).unevaluated : Infinity;
  const incomingUnevaluated = countVerdicts(report).unevaluated;
  if (existing && existingUnevaluated < incomingUnevaluated) {
    return { path, kept: true };
  }
  await fs.atomicWriteText(path, JSON.stringify(report, null, 2) + "\n");
  return { path, kept: false };
}

/** Exact `verKey` match — the "does this exact firmware have a capture" question. */
export async function resolveCapture(
  deviceId: string,
  ver: string | null | undefined,
): Promise<CaptureMeta | null> {
  const verKey = verKeyOf(ver);
  return (await listCaptures(deviceId)).find((c) => c.verKey === verKey) ?? null;
}

/** The full stored report behind a `CaptureMeta` — what the UI replays into the
 * probe log after a page reload. */
export async function loadCapture(deviceId: string, verKey: string): Promise<ProbeReport | null> {
  assertSafeVerKey(verKey);
  return readCapture(join(devicePaths(deviceId).probesDir, `${verKey}.json`));
}

export async function newestCapture(deviceId: string): Promise<CaptureMeta | null> {
  return (await listCaptures(deviceId))[0] ?? null;
}

export async function deleteCapture(deviceId: string, verKey: string): Promise<void> {
  assertSafeVerKey(verKey);
  const path = join(devicePaths(deviceId).probesDir, `${verKey}.json`);
  await fs.remove(path, { force: true });
}

export type ProbeSkip = { ver: string | null; at: string };

export type ProbeState = {
  required: boolean;
  reason: "never-probed" | "firmware-changed" | "none";
  /** What the device reports now. */
  ver: string | null;
  /** Capture for exactly that `ver`. */
  matched: CaptureMeta | null;
  /** What the mirror is showing, when there is no exact match. */
  newest: CaptureMeta | null;
  /** Only when it still applies — cleared automatically once `ver` moves. */
  skipped: ProbeSkip | null;
  /** Matching or fallback capture has unknown capability answers. */
  partial: boolean;
};

/**
 * The single definition of "is a probe required" — server-side deploy gate,
 * the three probe routes, and the UI banner all call this. See the plan's
 * §4.1 truth table for the exact row-by-row behavior this implements.
 */
export async function probeState(deviceId: string): Promise<ProbeState> {
  const device = await getDevice(deviceId);
  const ver = device?.info?.ver ?? null;
  const matched = ver != null ? await resolveCapture(deviceId, ver) : null;
  const newest = matched ? null : await newestCapture(deviceId);
  const rawSkip = device?.probeSkipped ?? null;
  const skipped = rawSkip && rawSkip.ver === ver ? rawSkip : null;

  if (matched) {
    return { required: false, reason: "none", ver, matched, newest: null, skipped, partial: matched.unevaluated > 0 };
  }
  if (ver == null && newest) {
    return { required: false, reason: "none", ver: null, matched: null, newest, skipped: null, partial: newest.unevaluated > 0 };
  }
  const reason: ProbeState["reason"] = newest ? "firmware-changed" : "never-probed";
  if (skipped) {
    return { required: false, reason, ver, matched: null, newest, skipped, partial: !!newest?.unevaluated };
  }
  return { required: true, reason, ver, matched: null, newest, skipped: null, partial: !!newest?.unevaluated };
}
