/**
 * Owns `.devroom/devices/<id>/probes/<verKey>.json` — one probe capture per
 * firmware, kept forever (M16 §2.2: an OTA must not silently overwrite the
 * previous firmware's answers). Also answers "is a probe required", the one
 * definition the deploy gate, the routes, and the UI banner all share.
 *
 * Everything else calls into this module; no other file builds a capture path.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { devicePaths } from "../core/paths.ts";
import { getDevice } from "../device/devices.ts";
import { isAbsent, isPresent, probeEntries } from "./probe-typings.ts";
import type { ProbeReport } from "./probe.ts";

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
};

function readCapture(path: string): ProbeReport | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ProbeReport;
    return Array.isArray(parsed?.results) ? parsed : null;
  } catch {
    return null;
  }
}

function countVerdicts(report: ProbeReport): { present: number; absent: number } {
  const entries = probeEntries(report);
  return { present: entries.filter(isPresent).length, absent: entries.filter(isAbsent).length };
}

/**
 * One-way, automatic, idempotent (M16 §3.4): adopts the legacy single-capture
 * `probe.json` into `probes/<verKey>.json` the first time this device's
 * captures are read. `verKey` comes from (a) the capture's own `ver`, else
 * (b) the cached `profile.json`'s `ver` when its `deviceIp` matches the
 * capture's, else (c) `"unknown"`. The legacy file is left in place.
 */
function migrateLegacy(deviceId: string): void {
  const paths = devicePaths(deviceId);
  if (existsSync(paths.probesDir)) return;
  const legacy = readCapture(paths.probe);
  if (!legacy) return;

  let verKey: string;
  if (typeof legacy.ver === "string" && legacy.ver) {
    verKey = verKeyOf(legacy.ver);
  } else if (existsSync(paths.profile)) {
    try {
      const profile = JSON.parse(readFileSync(paths.profile, "utf8")) as {
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

  mkdirSync(paths.probesDir, { recursive: true });
  const dest = join(paths.probesDir, `${verKey}.json`);
  if (!existsSync(dest)) {
    writeFileSync(dest, JSON.stringify(legacy, null, 2) + "\n", "utf8");
  }
}

/** Newest first. Runs the §3.4 migration first, so a never-yet-read device
 * with only a legacy `probe.json` still shows one capture. */
export function listCaptures(deviceId: string): CaptureMeta[] {
  migrateLegacy(deviceId);
  const dir = devicePaths(deviceId).probesDir;
  if (!existsSync(dir)) return [];
  const metas: CaptureMeta[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    const report = readCapture(path);
    if (!report) continue;
    const { present, absent } = countVerdicts(report);
    metas.push({
      ver: typeof report.ver === "string" ? report.ver : null,
      verKey: name.slice(0, -".json".length),
      at: report.at ?? "",
      path,
      present,
      absent,
    });
  }
  metas.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return metas;
}

/** mkdir -p + atomic (temp-then-rename) write, keyed by `verKeyOf(report.ver)`. */
export function writeCapture(deviceId: string, report: ProbeReport): string {
  const dir = devicePaths(deviceId).probesDir;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${verKeyOf(report.ver)}.json`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(report, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
  return path;
}

/** Exact `verKey` match — the "does this exact firmware have a capture" question. */
export function resolveCapture(deviceId: string, ver: string | null | undefined): CaptureMeta | null {
  const verKey = verKeyOf(ver);
  return listCaptures(deviceId).find((c) => c.verKey === verKey) ?? null;
}

/** The full stored report behind a `CaptureMeta` — what the UI replays into the
 * probe log after a page reload. */
export function loadCapture(deviceId: string, verKey: string): ProbeReport | null {
  assertSafeVerKey(verKey);
  return readCapture(join(devicePaths(deviceId).probesDir, `${verKey}.json`));
}

export function newestCapture(deviceId: string): CaptureMeta | null {
  return listCaptures(deviceId)[0] ?? null;
}

export function deleteCapture(deviceId: string, verKey: string): void {
  assertSafeVerKey(verKey);
  const path = join(devicePaths(deviceId).probesDir, `${verKey}.json`);
  if (existsSync(path)) unlinkSync(path);
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
};

/**
 * The single definition of "is a probe required" — server-side deploy gate,
 * the three probe routes, and the UI banner all call this. See the plan's
 * §4.1 truth table for the exact row-by-row behavior this implements.
 */
export function probeState(deviceId: string): ProbeState {
  const device = getDevice(deviceId);
  const ver = device?.info?.ver ?? null;
  const matched = ver != null ? resolveCapture(deviceId, ver) : null;
  const newest = matched ? null : newestCapture(deviceId);
  const rawSkip = device?.probeSkipped ?? null;
  const skipped = rawSkip && rawSkip.ver === ver ? rawSkip : null;

  if (matched) {
    return { required: false, reason: "none", ver, matched, newest: null, skipped };
  }
  if (ver == null && newest) {
    return { required: false, reason: "none", ver: null, matched: null, newest, skipped: null };
  }
  const reason: ProbeState["reason"] = newest ? "firmware-changed" : "never-probed";
  if (skipped) {
    return { required: false, reason, ver, matched: null, newest, skipped };
  }
  return { required: true, reason, ver, matched: null, newest, skipped: null };
}
