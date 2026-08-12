import {
  MARK,
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

function GroupMeta(props: {
  counts: Record<CheckStatus, number>;
  total: number;
}) {
  const { counts, total } = props;
  const tags: { cls: string; mark: string; n: number; label: string }[] = [
    { cls: "check-tag-fail", mark: MARK.fail, n: counts.fail, label: "failing" },
    { cls: "check-tag-warn", mark: MARK.warn, n: counts.warn, label: "warning" },
    {
      cls: "check-tag-skip",
      mark: MARK.skipped,
      n: counts.skipped,
      label: "skipped",
    },
    { cls: "check-tag-pass", mark: MARK.pass, n: counts.pass, label: "passing" },
    {
      cls: "check-tag-idle",
      mark: MARK.pending,
      n: counts.pending,
      label: "not run yet",
    },
  ];
  return (
    <span class="check-group-meta" title={`${total} checks in this group`}>
      {tags
        .filter((t) => t.n > 0)
        .map((t) => (
          <span
            key={t.cls}
            class={`check-tag ${t.cls}`}
            title={`${t.n} ${t.label}`}
          >
            {`${t.mark} ${t.n}`}
          </span>
        ))}
    </span>
  );
}

function RuleRow(props: { row: CheckRow }) {
  const { row } = props;
  return (
    <tr
      class={`check check-${row.status}`}
      title={`${row.rule} · ${row.status} — ${why(row)}`}
    >
      <td class="check-mark" aria-hidden="true">
        {MARK[row.status]}
      </td>
      <td class="check-rule">
        <span class="check-rule-name">{row.rule}</span>
        {row.status !== "pass" && row.status !== "pending" ? (
          <span class="check-about">{why(row)}</span>
        ) : null}
      </td>
      <td
        class="check-count"
        title={row.count ? plural(row.count, "finding") : undefined}
      >
        {row.count ? `${row.count}` : null}
      </td>
    </tr>
  );
}

function GroupSection(props: { group: CheckGroup; rows: CheckRow[] }) {
  const { group, rows } = props;
  if (!rows.length) return null;
  const counts = tally(rows);
  const open = counts.fail + counts.warn > 0;
  return (
    <details class="check-group" open={open}>
      <summary class="check-group-head" title={group.about}>
        <span class="check-group-label">{group.label}</span>
        <GroupMeta counts={counts} total={rows.length} />
      </summary>
      <table class="check-table">
        <tbody>
          {rows.map((row) => (
            <RuleRow key={row.rule} row={row} />
          ))}
        </tbody>
      </table>
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
