/**
 * APIs the device probe answered `"undefined"` for. Severity follows the
 * probe's provenance, because that is what decides whether the absence is a
 * fact about the deploy target or a fact about some other box:
 *
 * - the probe is **for the active device, on its current firmware** → `error`.
 *   Using the name throws a ReferenceError on the very device the next Deploy
 *   writes to.
 * - the probe is from another device, from no-longer-current firmware on the
 *   right device, or there is no active device → `warn`: a capture from the
 *   right box but the wrong firmware is exactly as advisory as one from
 *   another box (M16 §4.2) — the whole point of keying captures by firmware
 *   is that a stale one must not claim an error for an API the OTA may have
 *   since added.
 *
 * Every message names the probe it came from, so a finding can be falsified
 * by re-probing the real target.
 */
import ts from "typescript";
import {
  createSink,
  parseSource,
  type Finding,
} from "./lint-util.ts";
import {
  isAbsent,
  isPresent,
  probeEntries,
  probeOrigin,
  readProbeReport,
} from "../probe/probe-typings.ts";
import { activeDeviceIdentity, type ActiveIdentity } from "../device/devices.ts";
import { PROBE_PATH, SCRIPT_LABEL } from "../core/paths.ts";
import type { ProbeEntry, ProbeReport } from "../probe/probe.ts";

const RULE = "probe-absent-api";

type Absences = {
  /** Bare globals: `setTimeout`. */
  globals: Map<string, ProbeEntry>;
  /** Trailing member of a dotted id: `padStart` from `string.padStart`. */
  members: Map<string, ProbeEntry>;
  origin: string;
  /** True when the probe is for the active device, on its current firmware. */
  isActiveTarget: boolean;
  /** Set when the probe is for the right device but a different firmware. */
  staleNote: string | null;
};

/** `report.deviceId` first (M16 §3.2); `deviceIp` for a legacy capture that
 * predates it. Firmware is not compared here — that is the caller's job,
 * since "same box, different ver" and "same box, same ver" mean different
 * things to the caller. */
function isSameDevice(report: ProbeReport, active: ActiveIdentity): boolean {
  return typeof report.deviceId === "string" && report.deviceId.length > 0
    ? report.deviceId === active.id
    : typeof report.deviceIp === "string" && report.deviceIp.length > 0 && report.deviceIp === active.ip;
}

/**
 * Names are keyed on the last id segment, since a probe answer says nothing
 * about the receiver's type. A name some other probe found present is dropped
 * from both maps: `array.indexOf` present makes `indexOf` unreportable.
 */
async function readAbsences(
  path: string,
  active: ActiveIdentity | null,
): Promise<Absences | null> {
  const report = await readProbeReport(path);
  if (!report) return null;

  const globals = new Map<string, ProbeEntry>();
  const members = new Map<string, ProbeEntry>();
  const present = new Set<string>();

  for (const entry of probeEntries(report)) {
    const segments = entry.id.split(".");
    const name = segments[segments.length - 1]!;
    if (isPresent(entry)) present.add(name);
    else if (isAbsent(entry)) {
      (segments.length === 1 ? globals : members).set(name, entry);
    }
  }
  for (const name of present) {
    globals.delete(name);
    members.delete(name);
  }

  const sameDevice = active != null && isSameDevice(report, active);
  const reportVer = typeof report.ver === "string" ? report.ver : null;
  const isActiveTarget = sameDevice && reportVer === (active ? active.ver : null);
  const staleNote =
    sameDevice && !isActiveTarget && active?.ver
      ? `; device now runs ${active.ver}`
      : null;

  return {
    globals,
    members,
    origin: await probeOrigin(report),
    isActiveTarget,
    staleNote,
  };
}

function message(name: string, entry: ProbeEntry, absences: Absences): string {
  const head = absences.isActiveTarget
    ? `"${name}" is missing on the active device`
    : `"${name}" is missing on the probed device`;
  const tail = absences.isActiveTarget
    ? "using it throws a ReferenceError on the device this deploys to"
    : "advisory, your target may run other firmware";
  return `${head} — \`${entry.code}\` answered "undefined" (${absences.origin}${absences.staleNote ?? ""}); ${tail}`;
}

/** A property name in `a.b` or `{ b: … }` is not a reference to the global. */
function isValueReference(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === id) return false;
  return true;
}

export async function lintProbe(
  source: string,
  fileName = SCRIPT_LABEL,
  probePath = PROBE_PATH,
  active?: ActiveIdentity | null,
): Promise<Finding[]> {
  const resolvedActive = active === undefined ? await activeDeviceIdentity() : active;
  const absences = await readAbsences(probePath, resolvedActive);
  if (!absences) return [];

  const severity: Finding["severity"] = absences.isActiveTarget ? "error" : "warn";
  const sf = parseSource(source, fileName);
  const sink = createSink(sf, fileName);

  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const entry = absences.members.get(node.name.text);
      if (entry) {
        sink.at(node, RULE, severity, message(node.name.text, entry, absences));
      }
    } else if (ts.isIdentifier(node) && isValueReference(node)) {
      const entry = absences.globals.get(node.text);
      if (entry) {
        sink.at(node, RULE, severity, message(node.text, entry, absences));
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return sink.findings;
}
