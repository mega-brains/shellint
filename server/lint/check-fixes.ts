import type { Finding, FindingFix } from "./lint-util.ts";

export type CheckFixPreview = {
  count: number;
  rules: string[];
  before: string;
  after: string;
};

type Candidate = FindingFix & { rule: string };

/** Applies only non-overlapping fixes belonging to saved source. */
export function previewCheckFixes(
  source: string,
  findings: Finding[],
): CheckFixPreview | null {
  const candidates: Candidate[] = findings.flatMap((finding) =>
    finding.file === "scripts/main.ts" && finding.fix
      ? [{ ...finding.fix, rule: finding.rule }]
      : [],
  );
  candidates.sort((a, b) => b.start - a.start || b.end - a.end);

  const accepted: Candidate[] = [];
  let nextStart = source.length;
  for (const fix of candidates) {
    if (fix.start < 0 || fix.end < fix.start || fix.end > source.length) continue;
    if (fix.end > nextStart) continue;
    accepted.push(fix);
    nextStart = fix.start;
  }
  if (!accepted.length) return null;

  let after = source;
  for (const fix of accepted) {
    after = after.slice(0, fix.start) + fix.text + after.slice(fix.end);
  }
  if (after === source) return null;
  return {
    count: accepted.length,
    rules: [...new Set(accepted.map((fix) => fix.rule))],
    before: source,
    after,
  };
}
