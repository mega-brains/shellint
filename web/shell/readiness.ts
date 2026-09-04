/**
 * Deploy readiness as three gates (M18). Nothing new is tracked: this derives
 * "can I deploy, and if not why" from the build/check/probe results app.tsx
 * already holds, so the answer can be stated in the rail instead of hiding in a
 * disabled button's tooltip.
 */
import { tally, type CheckReport, type Finding } from "../check/check-types";
import type { Sizes } from "../lib/sizes";
import type { ProbeProgress } from "../probe/use-probe";

export type GateState = "ok" | "warn" | "fail" | "stale" | "unavailable";
export type GateId = "built" | "checked" | "probed";

export type Gate = {
  id: GateId;
  state: GateState;
  /** "built 5324 B", "checked 2 warn · 38/60", "no device / 14 rules skipped". */
  label: string;
  title: string;
};

export type ReadinessInput = {
  /** null until the first build of this session; false when it failed. */
  buildOk: boolean | null;
  /** Cleared to true by an edit — a build older than the buffer is stale. */
  buildStale: boolean;
  sizeProd: Sizes;
  estimateBytes: number | null;
  report: CheckReport | null;
  dialectFindings: Finding[] | null;
  /** Static/offline build: there is no device to probe, ever. */
  isStatic: boolean;
  hasDevice: boolean;
  probeRequired: boolean;
  probeSkipped: boolean;
  probeProgress: ProbeProgress | null;
  /** `createDeployGate().ready()` — the gate stays authoritative for the
   * button; the rail only explains it (a deliberately skipped probe, for one,
   * unblocks Deploy while the pill still reads "probe skipped"). */
  deployReady: boolean;
};

export type Readiness = {
  gates: Gate[];
  deployReady: boolean;
  /** "deploy ready", or the first thing standing in the way. */
  summary: string;
  summaryClass: "ready" | "blocked";
};

function builtGate(input: ReadinessInput): Gate {
  const bytes = input.sizeProd.min ?? input.sizeProd.raw ?? null;
  const size =
    bytes != null
      ? `${bytes} B`
      : input.estimateBytes != null
        ? `${input.estimateBytes} B est`
        : "—";
  if (input.buildOk === false) {
    return {
      id: "built",
      state: "fail",
      label: "build failed",
      title: "The last build failed — see the editor's error markers",
    };
  }
  if (input.buildOk === null) {
    return {
      id: "built",
      state: "stale",
      label: "not built",
      title: "No build in this session yet",
    };
  }
  if (input.buildStale) {
    return {
      id: "built",
      state: "stale",
      label: "build stale",
      title: "The buffer changed after the last build",
    };
  }
  return {
    id: "built",
    state: "ok",
    label: `built ${size}`,
    title: "Last build succeeded",
  };
}

function checkedGate(input: ReadinessInput): Gate {
  if (input.dialectFindings) {
    const errors = input.dialectFindings.filter(
      (f) => f.severity === "error",
    ).length;
    return {
      id: "checked",
      state: errors ? "fail" : "warn",
      label: errors
        ? `dialect guard ${errors} error`
        : `dialect guard ${input.dialectFindings.length} warn`,
      title: "From the last build's post-compile dialect guard — run Check for the full report",
    };
  }
  const report = input.report;
  if (!report) {
    return {
      id: "checked",
      state: "stale",
      label: "not checked",
      title: "No compliance check in this session yet",
    };
  }
  const counts = tally(report.checks);
  const scale = `${counts.pass}/${report.checks.length}`;
  if (report.counts.errors) {
    return {
      id: "checked",
      state: "fail",
      label: `checked ${report.counts.errors} fail · ${scale}`,
      title: "The compliance check reported errors",
    };
  }
  if (report.counts.warnings) {
    return {
      id: "checked",
      state: "warn",
      label: `checked ${report.counts.warnings} warn · ${scale}`,
      title: "The compliance check reported advisories only",
    };
  }
  return {
    id: "checked",
    state: "ok",
    label: `checked ${scale}`,
    title: "Every compliance check that could run, passed",
  };
}

function probedGate(input: ReadinessInput): Gate {
  if (input.probeProgress) {
    const { done, total, phase, run } = input.probeProgress;
    if (phase === "failed") {
      return {
        id: "probed",
        state: "fail",
        label: "probe failed",
        title: run?.error ?? "Capability probe failed",
      };
    }
    return {
      id: "probed",
      state: "warn",
      label: phase && phase !== "probing" ? `probe ${phase}` : `probing ${done}/${total}`,
      title: phase && phase !== "probing" ? `Capability probe: ${phase}` : "Capability probe in progress",
    };
  }
  if (input.isStatic || !input.hasDevice) {
    const skipped = input.report
      ? tally(input.report.checks).skipped
      : 0;
    return {
      id: "probed",
      state: "unavailable",
      label: skipped
        ? `no device / ${skipped} rules skipped`
        : "no device",
      title: "No device is active, so the capability rules cannot run",
    };
  }
  if (input.probeRequired) {
    return {
      id: "probed",
      state: "warn",
      label: "not probed",
      title: "This device has no capability probe for its firmware — click to run one",
    };
  }
  if (input.probeSkipped) {
    return {
      id: "probed",
      state: "warn",
      label: "probe skipped",
      title: "The capability probe was skipped for this firmware",
    };
  }
  return {
    id: "probed",
    state: "ok",
    label: "probed",
    title: "A capability probe matching this firmware is cached",
  };
}

export function deriveReadiness(input: ReadinessInput): Readiness {
  const gates = [builtGate(input), checkedGate(input), probedGate(input)];
  const [built, checked, probed] = gates;
  const deployReady = input.deployReady;
  let summary: string;
  let ready = true;
  if (deployReady) {
    summary = probed.state === "unavailable" ? "build ready · no device" : "deploy ready";
  } else if (built.state === "fail") {
    summary = "build failed — fix errors";
    ready = false;
  } else if (built.state !== "ok") {
    summary = `${built.label} — build first`;
    ready = false;
  } else if (checked.state === "stale") {
    summary = "not checked — check first";
    ready = false;
  } else if (checked.state === "fail") {
    summary = "check failed — fix findings";
    ready = false;
  } else if (probed.state === "warn" || probed.state === "unavailable") {
    summary = `${probed.label} — probe first`;
    ready = false;
  } else {
    summary = "deploy blocked";
    ready = false;
  }
  return {
    gates,
    deployReady,
    summary,
    summaryClass: ready ? "ready" : "blocked",
  };
}
