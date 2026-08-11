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

export type CheckReport = {
  ok: boolean;
  findings: Finding[];
  counts: { errors: number; warnings: number };
  artifacts: string[];
  profile: CheckProfileInfo | null;
};

export type CheckPanelEls = {
  panel: HTMLElement;
  summary: HTMLElement;
  list: HTMLElement;
};

function location(f: Finding): string {
  if (!f.file) return "";
  return f.line != null ? `${f.file}:${f.line}` : f.file;
}

export function summarize(counts: {
  errors: number;
  warnings: number;
}): string {
  if (!counts.errors && !counts.warnings) return "pass · no findings";
  const parts: string[] = [];
  if (counts.errors) parts.push(`${counts.errors} error${counts.errors > 1 ? "s" : ""}`);
  if (counts.warnings)
    parts.push(`${counts.warnings} warning${counts.warnings > 1 ? "s" : ""}`);
  return `${counts.errors ? "fail" : "pass"} · ${parts.join(" · ")}`;
}

export function renderFindings(
  els: CheckPanelEls,
  findings: Finding[],
  counts?: { errors: number; warnings: number },
): void {
  const resolved = counts ?? {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity !== "error").length,
  };
  els.panel.hidden = false;
  els.summary.textContent = summarize(resolved);
  els.summary.classList.toggle("error", resolved.errors > 0);
  els.list.replaceChildren();

  if (!findings.length) {
    const li = document.createElement("li");
    li.className = "finding ok";
    li.textContent =
      "script respects the Shelly/Espruino syntax, resource, semantic and size rules";
    els.list.appendChild(li);
    return;
  }

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
      const loc = document.createElement("span");
      loc.className = "finding-loc";
      loc.textContent = where;
      li.appendChild(loc);
    }
    els.list.appendChild(li);
  }
}
