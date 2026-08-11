/**
 * Advisory — APIs the device probe answered `"undefined"` for. Unlike tier 4,
 * this is a warning and never an error: types/generated-probe.json may come
 * from a different device or firmware than the one the script targets, so every
 * message names the probe it came from.
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
import { PROBE_PATH } from "./paths.ts";
import type { ProbeEntry } from "./probe.ts";

const RULE = "probe-absent-api";

type Absences = {
  /** Bare globals: `setTimeout`. */
  globals: Map<string, ProbeEntry>;
  /** Trailing member of a dotted id: `padStart` from `string.padStart`. */
  members: Map<string, ProbeEntry>;
  origin: string;
};

/**
 * Names are keyed on the last id segment, since a probe answer says nothing
 * about the receiver's type. A name some other probe found present is dropped
 * from both maps: `array.indexOf` present makes `indexOf` unreportable.
 */
function readAbsences(path: string): Absences | null {
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

  return { globals, members, origin: probeOrigin(report) };
}

function message(name: string, entry: ProbeEntry, origin: string): string {
  return `"${name}" is missing on the probed device — \`${entry.code}\` answered "undefined" (${origin}); advisory, your target may run other firmware`;
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
): Finding[] {
  const absences = readAbsences(probePath);
  if (!absences) return [];

  const sf = parseSource(source, fileName);
  const sink = createSink(sf, fileName);

  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const entry = absences.members.get(node.name.text);
      if (entry) {
        sink.at(node, RULE, "warn", message(node.name.text, entry, absences.origin));
      }
    } else if (ts.isIdentifier(node) && isValueReference(node)) {
      const entry = absences.globals.get(node.text);
      if (entry) {
        sink.at(node, RULE, "warn", message(node.text, entry, absences.origin));
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return sink.findings;
}
