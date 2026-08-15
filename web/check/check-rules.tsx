import {
  tally,
  why,
  type CheckCatalog,
  type CheckGroup,
  type CheckRow,
  type CheckStatus,
} from "./check-types";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * "1 warn · 5" — the interesting states named, the total last. A wall of
 * per-state pills was the old treatment and made every tier look alarming.
 */
function groupCount(counts: Record<CheckStatus, number>, total: number): string {
  const parts: string[] = [];
  if (counts.fail) parts.push(`${counts.fail} fail`);
  if (counts.warn) parts.push(`${counts.warn} warn`);
  if (counts.skipped) parts.push(`${counts.skipped} skipped`);
  if (counts.pending) parts.push("not run");
  parts.push(String(total));
  return parts.join(" · ");
}

function RuleRow(props: { row: CheckRow }) {
  const { row } = props;
  const explain = row.status !== "pass" && row.status !== "pending";
  return (
    <div
      class={`check check-${row.status}`}
      title={`${row.rule} · ${row.status} — ${why(row)}`}
    >
      <span class="check-dot" aria-hidden="true" />
      <span class="check-rule">
        <span class="check-rule-name">{row.rule}</span>
        {explain ? <span class="check-about">{why(row)}</span> : null}
      </span>
      <span
        class="check-count"
        title={row.count ? plural(row.count, "finding") : undefined}
      >
        {row.count ? `${row.count}` : null}
      </span>
    </div>
  );
}

function GroupSection(props: { group: CheckGroup; rows: CheckRow[] }) {
  const { group, rows } = props;
  if (!rows.length) return null;
  const counts = tally(rows);
  const open = counts.fail + counts.warn > 0;
  return (
    <details class="tier" open={open}>
      <summary class="tier-head" title={group.about}>
        <span class="tier-caret" aria-hidden="true">
          ▸
        </span>
        <span class="tier-label">{group.label}</span>
        <span class="tier-count">{groupCount(counts, rows.length)}</span>
      </summary>
      <div class="tier-rules">
        {rows.map((row) => (
          <RuleRow key={row.rule} row={row} />
        ))}
      </div>
    </details>
  );
}

export function CheckRules(props: {
  catalog: CheckCatalog | null;
  rows: CheckRow[];
}) {
  const groups: CheckGroup[] = props.catalog?.groups ?? [];
  const seen = new Set<string>();
  const sections = groups.map((group) => {
    seen.add(group.id);
    return (
      <GroupSection
        key={group.id}
        group={group}
        rows={props.rows.filter((r) => r.group === group.id)}
      />
    );
  });
  const rest = props.rows.filter((r) => !seen.has(r.group));
  return (
    <div class="check-rules" id="checkRules">
      {sections}
      {rest.length ? (
        <GroupSection
          group={{ id: "rest", label: "other checks", about: "" }}
          rows={rest}
        />
      ) : null}
    </div>
  );
}
