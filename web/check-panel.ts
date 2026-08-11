import { bindFindingNavigation } from "./goto-finding";
import { FINDINGS_EVENT } from "./finding-gutter";

export type Finding = {
  severity: "error" | "warn";
  rule: string;
  message: string;
  file?: string;
  line?: number;
};

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
  needs?: "profile" | "artifacts";
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
};

export type CheckPanelEls = {
  peek: HTMLElement;
  note: HTMLElement;
  findings: HTMLElement;
  rules: HTMLElement;
};

const MARK: Record<CheckStatus, string> = {
  pass: "✓",
  warn: "!",
  fail: "×",
  skipped: "–",
  pending: "·",
};

const WHY_SKIPPED: Record<string, string> = {
  profile: "needs a device profile — run Probe or Check while the device answers",
  artifacts: "needs dist/*.raw.js — run Build first",
};

function location(f: Finding): string {
  if (!f.file) return "";
  return f.line != null ? `${f.file}:${f.line}` : f.file;
}

/** Verdicts read as badges rather than prose; `label` stays for screen readers. */
type Badge = { cls: string; text: string; label?: string };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function countBadges(counts: { errors: number; warnings: number }): Badge[] {
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

function tally(rows: CheckRow[]): Record<CheckStatus, number> {
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

function ruleItem(row: CheckRow): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `check check-${row.status}`;

  const mark = document.createElement("span");
  mark.className = "check-mark";
  mark.textContent = MARK[row.status];
  mark.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  name.className = "check-rule";
  name.textContent = row.rule;

  const about = document.createElement("span");
  about.className = "check-about";
  about.textContent =
    row.status === "skipped" && row.needs
      ? `${row.about} — ${WHY_SKIPPED[row.needs]}`
      : row.about;

  li.append(mark, name, about);

  if (row.count) {
    const count = document.createElement("span");
    count.className = "check-count";
    count.textContent = `${row.count}`;
    count.title = plural(row.count, "finding");
    li.appendChild(count);
  }

  li.title = `${row.rule} · ${row.status}`;
  return li;
}

function groupSection(
  group: CheckGroup,
  rows: CheckRow[],
): HTMLLIElement | null {
  if (!rows.length) return null;
  const li = document.createElement("li");
  li.className = "check-group";

  const head = document.createElement("p");
  head.className = "check-group-head";

  const label = document.createElement("span");
  label.className = "check-group-label";
  label.textContent = group.label;

  const meta = document.createElement("span");
  meta.className = "check-group-meta";
  const counts = tally(rows);
  meta.textContent = counts.fail
    ? `${counts.fail} failing`
    : counts.warn
      ? `${counts.warn} warning`
      : counts.skipped === rows.length
        ? "skipped"
        : `${rows.length}`;

  head.append(label, meta);

  const about = document.createElement("p");
  about.className = "check-group-about";
  about.textContent = group.about;

  const list = document.createElement("ul");
  list.className = "check-list";
  for (const row of rows) list.appendChild(ruleItem(row));

  li.append(head, about, list);
  return li;
}

function renderRules(
  els: CheckPanelEls,
  catalog: CheckCatalog | null,
  rows: CheckRow[],
) {
  els.rules.replaceChildren();
  const groups: CheckGroup[] = catalog?.groups ?? [];
  const seen = new Set<string>();

  for (const group of groups) {
    const section = groupSection(
      group,
      rows.filter((r) => r.group === group.id),
    );
    seen.add(group.id);
    if (section) els.rules.appendChild(section);
  }

  const rest = rows.filter((r) => !seen.has(r.group));
  if (rest.length) {
    const section = groupSection(
      { id: "rest", label: "other checks", about: "" },
      rest,
    );
    if (section) els.rules.appendChild(section);
  }
}

function renderFindingList(els: CheckPanelEls, findings: Finding[]) {
  els.findings.replaceChildren();
  document.dispatchEvent(
    new CustomEvent<Finding[]>(FINDINGS_EVENT, { detail: findings }),
  );
  if (!findings.length) return;

  const ordered = [...findings].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1,
  );
  for (const f of ordered) {
    const li = document.createElement("li");
    li.className = `finding ${f.severity}`;

    const sev = document.createElement("span");
    sev.className = "finding-sev";
    sev.textContent = f.severity;

    const rule = document.createElement("span");
    rule.className = "finding-rule";
    rule.textContent = f.rule;

    const msg = document.createElement("span");
    msg.className = "finding-msg";
    msg.textContent = f.message;

    li.append(sev, rule, msg);

    const where = location(f);
    if (where) {
      // Clickable only with a line to jump to; otherwise it is a plain label.
      const loc = document.createElement(f.line != null ? "button" : "span");
      loc.className = "finding-loc";
      loc.textContent = where;
      if (loc instanceof HTMLButtonElement && f.file && f.line != null) {
        loc.type = "button";
        loc.dataset.file = f.file;
        loc.dataset.line = String(f.line);
        loc.title = `Go to ${where}`;
      }
      li.appendChild(loc);
    }
    els.findings.appendChild(li);
  }
  bindFindingNavigation(els.findings);
}

function setPeek(els: CheckPanelEls, badges: Badge[], failed: boolean) {
  els.peek.replaceChildren();
  badges.forEach((badge, i) => {
    if (i > 0) els.peek.append(" · ");
    const span = document.createElement("span");
    span.className = `badge ${badge.cls}`;
    span.textContent = badge.text;
    if (badge.label) span.setAttribute("aria-label", badge.label);
    els.peek.appendChild(span);
  });
  els.peek.classList.toggle("error", failed);
}

/** The indicator before any run: every check listed, none of them decided. */
export function renderCatalog(els: CheckPanelEls, catalog: CheckCatalog): void {
  const rows: CheckRow[] = catalog.checks.map((spec) => ({
    ...spec,
    status: "pending",
    count: 0,
  }));
  setPeek(els, [{ cls: "badge-idle", text: `${rows.length} checks · not run yet` }], false);
  els.note.textContent = "press Check to run all of them against the saved script";
  renderFindingList(els, []);
  renderRules(els, catalog, rows);
}

export function renderReport(
  els: CheckPanelEls,
  report: CheckReport,
  catalog: CheckCatalog | null,
): void {
  const counts = tally(report.checks);
  setPeek(
    els,
    [
      ...countBadges(report.counts),
      {
        cls: "badge-pass",
        text: `✓ ${counts.pass}/${report.checks.length}`,
        label: `${counts.pass} of ${report.checks.length} checks pass`,
      },
    ],
    report.counts.errors > 0,
  );

  const scope = report.artifacts.length
    ? `scripts/main.ts + ${report.artifacts.join(", ")}`
    : "scripts/main.ts";
  const profile = report.profile
    ? `device profile ${report.profile.source}`
    : "no device profile";
  els.note.textContent = [
    scope,
    profile,
    counts.skipped ? `${counts.skipped} skipped` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  renderFindingList(els, report.findings);
  renderRules(els, catalog, report.checks);
}

/**
 * The post-compile guard also runs inside Build, which has no full report —
 * so its findings land in the list without touching the per-rule verdicts.
 */
export function renderFindings(els: CheckPanelEls, findings: Finding[]): void {
  const errors = findings.filter((f) => f.severity === "error").length;
  setPeek(
    els,
    [
      { cls: "badge-idle", text: "build guard" },
      ...countBadges({ errors, warnings: findings.length - errors }),
    ],
    errors > 0,
  );
  els.note.textContent = "from the last build — press Check for the full run";
  renderFindingList(els, findings);
}
