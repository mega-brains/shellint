import { useRef } from "preact/hooks";
import { Group } from "../ui/measure";
import { CopyFindingsButton, FindingsList } from "./check-findings";
import { CheckRules } from "./check-rules";
import {
  pendingRows,
  tally,
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

type View = {
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
      failed: false,
      note: "press Check to run all of them against the saved script",
      findings: [],
      rows,
    };
  }
  return {
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

  const sites = view.findings.length;
  const rules = new Set(view.findings.map((f) => f.rule)).size;

  return (
    <div class="checks" id="checkPanel">
      <Group
        title="findings"
        id="findingsBlock"
        caption={
          sites
            ? `${rules} rule${rules === 1 ? "" : "s"} · ${sites} site${sites === 1 ? "" : "s"}`
            : "none"
        }
      >
        <div class="checks-note-row">
          <p class="checks-note group-note" id="checkNote">
            {view.note}
          </p>
          <CopyFindingsButton findings={view.findings} />
        </div>
        <FindingsList findings={view.findings} />
      </Group>

      <Group title="rule tiers" id="tiersBlock" caption="pass / warn / skipped">
        <CheckRules catalog={props.catalog} rows={view.rows} />
      </Group>
    </div>
  );
}
