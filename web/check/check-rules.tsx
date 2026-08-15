import { useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  tally,
  why,
  type CheckCatalog,
  type CheckGroup,
  type CheckRow,
  type CheckStatus,
} from "./check-types";
import { OptTip, tipStyleFor, type OptTipContent } from "../ui/option-tip";
import { RULE_TIPS } from "./check-tips";

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

/** Rule name/description → the shared opt-tip content shape; no example for rules RULE_TIPS doesn't cover (inputs group, dynamic capability checks). */
function tipFor(row: CheckRow): OptTipContent {
  const ex = RULE_TIPS[row.rule];
  return {
    name: row.rule,
    blurb: why(row),
    before: ex?.before ?? [],
    after: ex?.after ?? [],
  };
}

function RuleRow(props: {
  row: CheckRow;
  tipOpen: boolean;
  onOpen: (row: CheckRow, el: HTMLElement) => void;
  onClose: () => void;
}) {
  const { row } = props;
  return (
    <div
      class={`check check-${row.status}`}
      tabIndex={0}
      aria-describedby={props.tipOpen ? "checkTipLive" : undefined}
      onMouseEnter={(e) => props.onOpen(row, e.currentTarget as HTMLElement)}
      onMouseLeave={props.onClose}
      onFocus={(e) => props.onOpen(row, e.currentTarget as HTMLElement)}
      onBlur={props.onClose}
    >
      <span class="check-dot" aria-hidden="true" />
      <span class="check-rule">
        <span class="check-rule-name">{row.rule}</span>
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

function GroupSection(props: {
  group: CheckGroup;
  rows: CheckRow[];
  tipRule: string | null;
  onOpen: (row: CheckRow, el: HTMLElement) => void;
  onClose: () => void;
}) {
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
          <RuleRow
            key={row.rule}
            row={row}
            tipOpen={props.tipRule === row.rule}
            onOpen={props.onOpen}
            onClose={props.onClose}
          />
        ))}
      </div>
    </details>
  );
}

export function CheckRules(props: {
  catalog: CheckCatalog | null;
  rows: CheckRow[];
}) {
  const [tipRow, setTipRow] = useState<CheckRow | null>(null);
  const [tipStyle, setTipStyle] = useState<JSX.CSSProperties>({});

  const onOpen = (row: CheckRow, el: HTMLElement) => {
    setTipRow(row);
    setTipStyle(tipStyleFor(el.getBoundingClientRect()));
  };
  const onClose = () => setTipRow(null);

  const groups: CheckGroup[] = props.catalog?.groups ?? [];
  const seen = new Set<string>();
  const sections = groups.map((group) => {
    seen.add(group.id);
    return (
      <GroupSection
        key={group.id}
        group={group}
        rows={props.rows.filter((r) => r.group === group.id)}
        tipRule={tipRow?.rule ?? null}
        onOpen={onOpen}
        onClose={onClose}
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
          tipRule={tipRow?.rule ?? null}
          onOpen={onOpen}
          onClose={onClose}
        />
      ) : null}
      {tipRow ? <OptTip open content={tipFor(tipRow)} style={tipStyle} /> : null}
      {/* Stable id for aria-describedby while a tip is open. */}
      {tipRow ? (
        <span id="checkTipLive" class="visually-hidden">
          {why(tipRow)}
        </span>
      ) : null}
    </div>
  );
}
