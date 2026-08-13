/**
 * APIs the device probe answered `"undefined"` for. Severity follows the
 * probe's provenance, because that is what decides whether the absence is a
 * fact about the deploy target or a fact about some other box:
 *
 * - the probe came from the **active** device → `error`. Using the name throws
 *   a ReferenceError on the very device the next Deploy writes to.
 * - the probe came from another device, or there is no active device →
 *   `warn`, as before: types/generated-probe.json may describe a different
 *   model or firmware than the script targets.
 *
 * Either way every message names the probe it came from, so a finding can be
 * falsified by re-probing the real target.
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
} from "./probe-typings.ts";
import { activeDeviceIp } from "./devices.ts";
import { PROBE_PATH } from "./paths.ts";
import type { ProbeEntry } from "./probe.ts";

const RULE = "probe-absent-api";

type Absences = {
  /** Bare globals: `setTimeout`. */
  globals: Map<string, ProbeEntry>;
  /** Trailing member of a dotted id: `padStart` from `string.padStart`. */
  members: Map<string, ProbeEntry>;
  origin: string;
  /** True when the probe describes the device the next Deploy targets. */
  isActiveTarget: boolean;
};

/**
 * Names are keyed on the last id segment, since a probe answer says nothing
 * about the receiver's type. A name some other probe found present is dropped
 * from both maps: `array.indexOf` present makes `indexOf` unreportable.
 */
function readAbsences(path: string, activeIp: string | null): Absences | null {
  const report = readProbeReport(path);
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

  return {
    globals,
    members,
    origin: probeOrigin(report),
    isActiveTarget:
      typeof report.deviceIp === "string" &&
      report.deviceIp.length > 0 &&
      report.deviceIp === activeIp,
  };
}

function message(name: string, entry: ProbeEntry, absences: Absences): string {
  const head = absences.isActiveTarget
    ? `"${name}" is missing on the active device`
    : `"${name}" is missing on the probed device`;
  const tail = absences.isActiveTarget
    ? "using it throws a ReferenceError on the device this deploys to"
    : "advisory, your target may run other firmware";
  return `${head} — \`${entry.code}\` answered "undefined" (${absences.origin}); ${tail}`;
}

/** A property name in `a.b` or `{ b: … }` is not a reference to the global. */
function isValueReference(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === id) return false;
  return true;
}

export function lintProbe(
  source: string,
  fileName = "scripts/main.ts",
  probePath = PROBE_PATH,
  activeIp: string | null = activeDeviceIp(),
): Finding[] {
  const absences = readAbsences(probePath, activeIp);
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
