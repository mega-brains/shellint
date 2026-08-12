import { useRef } from "preact/hooks";
import { Collapsible } from "./collapsible";
import { CopyFindingsButton, FindingsList } from "./check-findings";
import { CheckRules } from "./check-rules";
import {
  countBadges,
  pendingRows,
  tally,
  type Badge,
  type CheckCatalog,
  type CheckReport,
  type CheckRow,
  type Finding,
} from "./check-types";

export type {
  CheckCatalog,
  CheckReport,
  Finding,
} from "./check-types";
export { summarize } from "./check-types";

export type CheckPanelProps = {
  catalog: CheckCatalog | null;
  report: CheckReport | null;
  /** Dialect-guard findings from build (no full report). */
  dialectFindings: Finding[] | null;
};

function PeekBadges(props: { badges: Badge[]; failed: boolean }) {
  return (
    <p class={`panel-peek${props.failed ? " error" : ""}`} id="checkPeek">
      {props.badges.map((badge, i) => (
        <span key={`${badge.cls}:${badge.text}`}>
          {i > 0 ? " · " : null}
          <span class={`badge ${badge.cls}`} aria-label={badge.label}>
            {badge.text}
          </span>
        </span>
      ))}
    </p>
  );
}

type View = {
  badges: Badge[];
  failed: boolean;
  note: string;
  findings: Finding[];
  rows: CheckRow[];
};

function deriveView(props: CheckPanelProps, keptRows: CheckRow[]): View {
  if (props.report) {
    const counts = tally(props.report.checks);
    const scope = props.report.artifacts.length
      ? `scripts/main.ts + ${props.report.artifacts.join(", ")}`
      : "scripts/main.ts";
    const profile = props.report.profile
      ? `device profile ${props.report.profile.source}`
      : "no device profile";
    return {
      badges: [
        ...countBadges(props.report.counts),
        {
          cls: "badge-pass",
          text: `✓ ${counts.pass}/${props.report.checks.length}`,
          label: `${counts.pass} of ${props.report.checks.length} checks pass`,
        },
      ],
      failed: props.report.counts.errors > 0,
      note: [
        scope,
        profile,
        counts.skipped ? `${counts.skipped} skipped` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      findings: props.report.findings,
      rows: props.report.checks,
    };
  }
  if (props.dialectFindings) {
    const findings = props.dialectFindings;
    const errors = findings.filter((f) => f.severity === "error").length;
    return {
      badges: [
        { cls: "badge-idle", text: "build guard" },
        ...countBadges({ errors, warnings: findings.length - errors }),
      ],
      failed: errors > 0,
      note: "from the last build — press Check for the full run",
      findings,
      // Build guard does not recompute per-rule verdicts — keep the last table.
      rows: keptRows,
    };
  }
  if (props.catalog) {
    const rows = pendingRows(props.catalog);
    return {
      badges: [
        {
          cls: "badge-idle",
          text: `${rows.length} checks · not run yet`,
        },
      ],
      failed: false,
      note: "press Check to run all of them against the saved script",
      findings: [],
      rows,
    };
  }
  return {
    badges: [{ cls: "badge-idle", text: "not run yet" }],
    failed: false,
    note: "—",
    findings: [],
    rows: [],
  };
}

export function CheckPanel(props: CheckPanelProps) {
  const keptRows = useRef<CheckRow[]>([]);
  if (props.report) keptRows.current = props.report.checks;
  else if (props.catalog && !props.dialectFindings) {
    keptRows.current = pendingRows(props.catalog);
  }
  const view = deriveView(props, keptRows.current);

  return (
    <Collapsible
      storageKey="shelly-devroom.checkPanel.collapsed"
      defaultCollapsed={true}
      panelId="checkPanel"
      panelClass="checks"
      bodyId="checkBody"
      headId="checkHead"
      toggleId="checkToggle"
      title="Show or hide every compliance check, what it enforces and its verdict"
      ariaLabel="Compliance checks"
      headChildren={
        <>
          <h2>check</h2>
          <PeekBadges badges={view.badges} failed={view.failed} />
        </>
      }
    >
      <div class="checks-body" id="checkBody">
        <div class="checks-note-row">
          <p class="checks-note" id="checkNote">
            {view.note}
          </p>
          <CopyFindingsButton findings={view.findings} />
        </div>
        <FindingsList findings={view.findings} />
        <CheckRules catalog={props.catalog} rows={view.rows} />
      </div>
    </Collapsible>
  );
}
