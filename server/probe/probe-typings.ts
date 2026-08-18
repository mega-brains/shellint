/**
 * Turns the device probe answers (types/generated-probe.json) into the two
 * things nothing consumed them for so far: an advisory types/generated.d.ts,
 * and the present/absent verdicts server/lint/lint-probe.ts warns from.
 *
 * Driven entirely by whatever ids the probe wrote — an id this file has never
 * seen is just another entry, and an answer outside the `typeof` vocabulary is
 * carried through with no opinion attached.
 */
import { runtime } from "#shellint/runtime";
import { PROBE_PATH, ROOT } from "../core/paths.ts";
import { readDeviceProfile } from "../device/device-profile.ts";
import { activeDeviceIdentity } from "../device/devices.ts";
import type { ProbeEntry, ProbeReport } from "./probe.ts";

const { fs } = runtime;
const { dirname, join } = runtime.path;

export const GENERATED_DTS_PATH = join(ROOT, "types", "generated.d.ts");

/** `typeof` answers that map onto a declaration. Anything else is no opinion. */
const TYPE_FOR_ANSWER: Record<string, string> = {
  function: "(...args: unknown[]) => unknown",
  object: "object",
  string: "string",
  number: "number",
  boolean: "boolean",
};

/** The one answer that proves an API is missing on the probed device. */
const ABSENT_ANSWER = "undefined";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Reserved words are identifier-shaped but illegal as a `const`/`namespace`
 * name — e.g. the `hoisting.var` probe id. Segments matching one are skipped
 * rather than emitted as invalid `.d.ts` syntax. */
const RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "new",
  "null", "return", "super", "switch", "this", "throw", "true", "try",
  "typeof", "var", "void", "while", "with",
]);

/**
 * `present` means the probe confirmed the API is there. It is *not* the
 * negation of "confirmed absent": an entry that errored, or answered something
 * outside the `typeof` vocabulary, is neither.
 */
export type ProbeVerdict = { id: string; present: boolean; result: unknown };

export async function readProbeReport(path = PROBE_PATH): Promise<ProbeReport | null> {
  if (!(await fs.exists(path))) return null;
  try {
    const parsed = JSON.parse(await fs.readText(path)) as ProbeReport;
    return Array.isArray(parsed?.results) ? parsed : null;
  } catch {
    return null;
  }
}

/** Entries with a usable id, in the order the probe ran them. */
export function probeEntries(report: ProbeReport): ProbeEntry[] {
  return report.results.filter(
    (e): e is ProbeEntry => typeof e?.id === "string" && e.id.length > 0,
  );
}

export function isPresent(entry: ProbeEntry): boolean {
  return (
    entry.ok === true &&
    typeof entry.result === "string" &&
    entry.result in TYPE_FOR_ANSWER
  );
}

export function isAbsent(entry: ProbeEntry): boolean {
  return entry.ok === true && entry.result === ABSENT_ANSWER;
}

/** Which device, which firmware, when — so a finding can be falsified. `ver`
 * comes from the report's own provenance (M16 §3.2) first; `device-profile.json`
 * is only the fallback for a capture written before that field existed. */
export async function probeOrigin(report: ProbeReport): Promise<string> {
  const profile = await readDeviceProfile();
  const ver =
    typeof report.ver === "string" && report.ver
      ? report.ver
      : profile?.deviceIp === report.deviceIp && profile.ver
        ? profile.ver
        : "unknown";
  return `${report.deviceIp ?? "unknown device"} fw ${ver}, probed ${report.at ?? "unknown date"}`;
}

export async function readProbeVerdicts(path = PROBE_PATH): Promise<ProbeVerdict[]> {
  const report = await readProbeReport(path);
  if (!report) return [];
  return probeEntries(report).map((e) => ({
    id: e.id,
    present: isPresent(e),
    result: e.result,
  }));
}

type Node = { children: Map<string, Node>; leaf: ProbeEntry | null };

function emptyNode(): Node {
  return { children: new Map(), leaf: null };
}

/** `string.padStart` becomes namespace `string` holding const `padStart`. */
function insert(root: Node, entry: ProbeEntry): boolean {
  const segments = entry.id.split(".");
  if (!segments.every((s) => IDENTIFIER.test(s) && !RESERVED.has(s)))
    return false;
  let node = root;
  for (const segment of segments.slice(0, -1)) {
    const next = node.children.get(segment) ?? emptyNode();
    node.children.set(segment, next);
    node = next;
  }
  const last = segments[segments.length - 1]!;
  const leaf = node.children.get(last) ?? emptyNode();
  leaf.leaf = entry;
  node.children.set(last, leaf);
  return true;
}

function render(node: Node, depth: number): string[] {
  const pad = "  ".repeat(depth);
  const lines: string[] = [];
  for (const [name, child] of node.children) {
    if (child.leaf && child.children.size === 0) {
      const type = TYPE_FOR_ANSWER[child.leaf.result as string]!;
      lines.push(`${pad}/** \`${child.leaf.code}\` → "${child.leaf.result}" */`);
      lines.push(`${pad}const ${name}: ${type};`);
      continue;
    }
    lines.push(`${pad}namespace ${name} {`);
    lines.push(...render(child, depth + 1));
    lines.push(`${pad}}`);
  }
  return lines;
}

/** Set when the mirrored capture is *for* the active device but names a
 * firmware different from what it reports right now — the mirror is still
 * what Tier 4 lint reads, but the operator should re-probe before trusting
 * it. Silent for a mirror from some other device: that is a separate,
 * pre-existing advisory (`probe-absent-api`'s `warn` severity), not staleness. */
async function staleNote(report: ProbeReport | null): Promise<string> {
  if (!report || typeof report.ver !== "string" || !report.ver) return "";
  const active = await activeDeviceIdentity();
  if (!active?.ver) return "";
  const sameDevice =
    typeof report.deviceId === "string" && report.deviceId.length > 0
      ? report.deviceId === active.id
      : report.deviceIp === active.ip;
  if (!sameDevice || active.ver === report.ver) return "";
  return ` (stale — device now runs ${active.ver})`;
}

async function header(report: ProbeReport | null): Promise<string> {
  const origin = report ? await probeOrigin(report) : "no probe report yet";
  return [
    "/**",
    " * GENERATED FILE — do not edit by hand. Regenerate with `mise run probe`.",
    ` * Source: types/generated-probe.json (${origin}${await staleNote(report)}).`,
    " *",
    " * ADVISORY ONLY. It is not part of the device compile and does not stand in",
    " * for types/espruino-lib.d.ts: every declaration sits inside one namespace,",
    " * so this file adds no global and changes no typecheck. It records the",
    " * surface the probe confirmed present; the confirmed-absent half is reported",
    " * by the `probe-absent-api` lint check instead.",
    " */",
  ].join("\n");
}

/**
 * The `.d.ts` for the probe-confirmed-present surface, plus the ids on each
 * side of the verdict. Absent ids are deliberately *not* declared here — the
 * lint pass is where their absence is reported.
 */
export async function generateTypings(path = PROBE_PATH): Promise<{
  dts: string;
  present: string[];
  absent: string[];
}> {
  const report = await readProbeReport(path);
  const entries = report ? probeEntries(report) : [];
  const root = emptyNode();
  const present: string[] = [];
  for (const entry of entries) {
    if (isPresent(entry) && insert(root, entry)) present.push(entry.id);
  }

  const body = render(root, 1);
  const dts = [
    await header(report),
    "",
    body.length
      ? `declare namespace ProbedDevice {\n${body.join("\n")}\n}`
      : "declare namespace ProbedDevice {}",
    "",
  ].join("\n");

  return {
    dts,
    present,
    absent: entries.filter(isAbsent).map((e) => e.id),
  };
}

export async function writeGeneratedTypings(path = PROBE_PATH): Promise<{
  path: string;
  present: string[];
  absent: string[];
}> {
  const { dts, present, absent } = await generateTypings(path);
  await fs.mkdir(dirname(GENERATED_DTS_PATH), { recursive: true });
  await fs.atomicWriteText(GENERATED_DTS_PATH, dts);
  return { path: GENERATED_DTS_PATH, present, absent };
}
