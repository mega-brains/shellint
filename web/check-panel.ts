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

function why(row: CheckRow): string {
  return row.status === "skipped" && row.needs
    ? `${row.about} — ${WHY_SKIPPED[row.needs]}`
    : row.about;
}

/** One table row per check: mark, rule, findings. Prose only where it earns it. */
function ruleRow(row: CheckRow): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = `check check-${row.status}`;
  tr.title = `${row.rule} · ${row.status} — ${why(row)}`;

  const mark = document.createElement("td");
  mark.className = "check-mark";
  mark.textContent = MARK[row.status];
  mark.setAttribute("aria-hidden", "true");

  const name = document.createElement("td");
  name.className = "check-rule";
  name.appendChild(text("check-rule-name", row.rule));
  // A passing rule needs no explanation; anything else does.
  if (row.status !== "pass" && row.status !== "pending") {
    name.appendChild(text("check-about", why(row)));
  }

  const count = document.createElement("td");
  count.className = "check-count";
  if (row.count) {
    count.textContent = `${row.count}`;
    count.title = plural(row.count, "finding");
  }

  tr.append(mark, name, count);
  return tr;
}

/** Group verdict in the summary, so a collapsed group still says how it went. */
function groupMeta(counts: Record<CheckStatus, number>, total: number) {
  const meta = document.createElement("span");
  meta.className = "check-group-meta";
  const add = (cls: string, mark: string, n: number, label: string) => {
    if (!n) return;
    const tag = text(`check-tag ${cls}`, `${mark} ${n}`);
    tag.title = `${n} ${label}`;
    meta.appendChild(tag);
  };
  add("check-tag-fail", MARK.fail, counts.fail, "failing");
  add("check-tag-warn", MARK.warn, counts.warn, "warning");
  add("check-tag-skip", MARK.skipped, counts.skipped, "skipped");
  add("check-tag-pass", MARK.pass, counts.pass, "passing");
  add("check-tag-idle", MARK.pending, counts.pending, "not run yet");
  meta.title = `${total} checks in this group`;
  return meta;
}

/**
 * Groups collapse by default and open themselves only when something inside
 * needs attention, so a clean run is a short list of headers.
 */
function groupSection(group: CheckGroup, rows: CheckRow[]): HTMLElement | null {
  if (!rows.length) return null;
  const counts = tally(rows);

  const details = document.createElement("details");
  details.className = "check-group";
  details.open = counts.fail + counts.warn > 0;

  const summary = document.createElement("summary");
  summary.className = "check-group-head";
  summary.title = group.about;
  summary.append(
    text("check-group-label", group.label),
    groupMeta(counts, rows.length),
  );

  const table = document.createElement("table");
  table.className = "check-table";
  const body = document.createElement("tbody");
  for (const row of rows) body.appendChild(ruleRow(row));
  table.appendChild(body);

  details.append(summary, table);
  return details;
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

/** Decoration only: the severity word and the location text carry the meaning. */
function glyph(className: string, mark: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = mark;
  span.setAttribute("aria-hidden", "true");
  return span;
}

function text(className: string, value: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = value;
  return span;
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
    if (f.file && f.line != null) {
      li.dataset.file = f.file;
      li.dataset.line = String(f.line);
    }

    const isError = f.severity === "error";
    const sev = text(
      `badge ${isError ? "badge-fail" : "badge-warn"} finding-sev`,
      isError ? "ERROR" : "WARN",
    );

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
      loc.append(
        glyph("finding-loc-sev", f.severity === "error" ? "✕" : "⚠"),
        text("finding-loc-text", where),
      );
      if (loc instanceof HTMLButtonElement && f.file && f.line != null) {
        loc.type = "button";
        loc.dataset.file = f.file;
        loc.dataset.line = String(f.line);
        loc.title = `Go to ${where}`;
        loc.append(glyph("finding-loc-go", "↗"));
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
