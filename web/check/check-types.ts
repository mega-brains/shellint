/** Shared check-panel types and pure summary helpers. */
export type Finding = {
  severity: "error" | "warn";
  rule: string;
  message: string;
  file?: string;
  line?: number;
  fix?: FindingFix;
};

export type FindingFix = {
  title: string;
  start: number;
  end: number;
  text: string;
};

export type CheckFixPreview = {
  count: number;
  rules: string[];
  before: string;
  after: string;
};

export function findingFixPreview(
  finding: Finding,
  source: string | undefined,
): CheckFixPreview | null {
  const fix = finding.fix;
  if (!fix || source === undefined) return null;
  if (fix.start < 0 || fix.end < fix.start || fix.end > source.length) return null;
  const after = source.slice(0, fix.start) + fix.text + source.slice(fix.end);
  if (after === source) return null;
  return { count: 1, rules: [finding.rule], before: source, after };
}

export type CheckProfileInfo = {
  source: "live" | "cache";
  at: string;
  deviceIp: string;
  model: string | null;
  gen: number | null;
  ver: string | null;
};

/** "pending" is UI-only: the catalog is known but no run has happened yet. */
export type CheckStatus = "pass" | "warn" | "fail" | "skipped" | "pending";

export type CheckSpec = {
  rule: string;
  group: string;
  about: string;
  needs?: "profile" | "artifacts" | "probe" | "types" | "parse";
};

export type CheckRow = CheckSpec & { status: CheckStatus; count: number };

export type CheckGroup = { id: string; label: string; about: string };

export type CheckCatalog = { groups: CheckGroup[]; checks: CheckSpec[] };

export type CheckReport = {
  ok: boolean;
  findings: Finding[];
  counts: { errors: number; warnings: number };
  checks: CheckRow[];
  artifacts: string[];
  profile: CheckProfileInfo | null;
  fixes: CheckFixPreview | null;
};

export const MARK: Record<CheckStatus, string> = {
  pass: "✓",
  warn: "!",
  fail: "×",
  skipped: "–",
  pending: "·",
};

export const WHY_SKIPPED: Record<string, string> = {
  profile: "needs a device profile — run Probe or Check while the device answers",
  artifacts: "needs dist/*.raw.js — run Build first",
  probe: "needs a device capability probe — run Probe first",
  types: "needs types/*.d.ts to be readable",
  parse: "scripts/main.ts does not parse — fix the syntax errors first",
};

export type Badge = { cls: string; text: string; label?: string };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function countBadges(counts: {
  errors: number;
  warnings: number;
}): Badge[] {
  const out: Badge[] = [];
  if (counts.errors) {
    out.push({
      cls: "badge-fail",
      text: `❌ ${counts.errors}`,
      label: plural(counts.errors, "error"),
    });
  }
  if (counts.warnings) {
    out.push({
      cls: "badge-warn",
      text: `⚠️ ${counts.warnings}`,
      label: plural(counts.warnings, "warning"),
    });
  }
  return out;
}

export function summarize(counts: {
  errors: number;
  warnings: number;
}): string {
  const badges = countBadges(counts);
  return badges.length ? badges.map((b) => b.text).join(" · ") : "✓ pass";
}

export function tally(rows: CheckRow[]): Record<CheckStatus, number> {
  const out: Record<CheckStatus, number> = {
    pass: 0,
    warn: 0,
    fail: 0,
    skipped: 0,
    pending: 0,
  };
  for (const r of rows) out[r.status] += 1;
  return out;
}

export function why(row: CheckRow): string {
  return row.status === "skipped" && row.needs
    ? `${row.about} — ${WHY_SKIPPED[row.needs]}`
    : row.about;
}

export function findingLocation(f: Finding): string {
  if (!f.file) return "";
  return f.line != null ? `${f.file}:${f.line}` : f.file;
}

export function findingsAsText(findings: Finding[]): string {
  return findings
    .map((f) => {
      const where = findingLocation(f);
      const sev = f.severity.toUpperCase();
      const loc = where ? ` @ ${where}` : "";
      return `${sev} [${f.rule}] ${f.message}${loc}`;
    })
    .join("\n");
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return (a.line ?? Infinity) - (b.line ?? Infinity);
  });
}

export function pendingRows(catalog: CheckCatalog): CheckRow[] {
  return catalog.checks.map((spec) => ({ ...spec, status: "pending", count: 0 }));
}
