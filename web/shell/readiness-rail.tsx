import { useEffect, useState } from "preact/hooks";
import { Button } from "../ui/button";
import type { Gate, GateId, Readiness } from "./readiness";

export type ReadinessRailProps = {
  readiness: Readiness;
  status: string;
  statusError?: boolean;
  /** built → build tab, checked → check tab, probed → run a probe. */
  onGate: (id: GateId) => void;
};

/**
 * The permanent answer to "can I deploy, and if not why" — three gate pills, a
 * summary word, and the one transient status line, which sits at the right end
 * so a new message never reflows the row.
 */
export function ReadinessRail(props: ReadinessRailProps) {
  const [statusHidden, setStatusHidden] = useState(false);
  useEffect(() => setStatusHidden(false), [props.status]);

  return (
    <div class="rail" id="readinessRail">
      {props.readiness.gates.map((gate) => (
        <GatePill key={gate.id} gate={gate} onClick={() => props.onGate(gate.id)} />
      ))}
      <span class="rail-sep" aria-hidden="true" />
      <span
        class={`rail-summary ${props.readiness.summaryClass}`}
        id="railSummary"
      >
        {props.readiness.summary}
      </span>
      <span class="rail-spacer" />
      <p
        class={`status${props.statusError ? " error" : ""}`}
        id="statusLine"
        role="status"
        hidden={statusHidden}
      >
        {props.status}
      </p>
      <Button
        class="status-close"
        hidden={statusHidden}
        onClick={() => setStatusHidden(true)}
        aria-label="Dismiss status"
        title="Dismiss status"
      >
        ×
      </Button>
    </div>
  );
}

const GATE_ACTION: Record<GateId, string> = {
  built: "Show the build tab",
  checked: "Show the check tab",
  probed: "Run a capability probe on the device",
};

function GatePill(props: { gate: Gate; onClick: () => void }) {
  const { gate } = props;
  return (
    <Button
      class={`gate gate-${gate.state}`}
      id={`gate-${gate.id}`}
      data-testid={`gate-${gate.id}`}
      title={`${gate.title} — ${GATE_ACTION[gate.id].toLowerCase()}`}
      onClick={props.onClick}
    >
      <span class="gate-dot" aria-hidden="true" />
      <span class="gate-text">{gate.label}</span>
    </Button>
  );
}
