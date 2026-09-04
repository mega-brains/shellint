/** One in-process probe at once. CLI probes run elsewhere. */
export type ProbePhase =
  | "idle"
  | "connecting"
  | "device-info"
  | "eco"
  | "acquiring-host"
  | "probing"
  | "reviving-host"
  | "cleanup"
  | "done"
  | "failed";

export type ProbeRun = {
  runId: string;
  deviceId: string | null;
  phase: ProbePhase;
  done: number;
  total: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

let activeRun: ProbeRun | null = null;
let latestRun: ProbeRun | null = null;
let sequence = 0;

export class ProbeBusyError extends Error {
  run: ProbeRun;
  constructor(run: ProbeRun) {
    super("a capability probe is already running");
    this.name = "ProbeBusyError";
    this.run = run;
  }
}

export function startProbeRun(): ProbeRun {
  if (activeRun) throw new ProbeBusyError(activeRun);
  const run: ProbeRun = {
    runId: `${Date.now()}-${++sequence}`,
    deviceId: null,
    phase: "connecting",
    done: 0,
    total: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  activeRun = run;
  latestRun = run;
  return run;
}

export function updateProbeRun(run: ProbeRun, update: Partial<ProbeRun>): void {
  if (latestRun !== run) return;
  Object.assign(run, update);
}

/**
 * First call wins. `runProbe` finishes a failed run from its `catch` and then
 * again from its `finally`; without this guard the second, error-less call
 * relabels a crashed run `done` and drops its message.
 */
export function finishProbeRun(run: ProbeRun, error: unknown = null): void {
  if (latestRun !== run || run.finishedAt) return;
  run.phase = error ? "failed" : "done";
  run.error = error instanceof Error ? error.message : error ? String(error) : null;
  run.finishedAt = new Date().toISOString();
  if (activeRun === run) activeRun = null;
}

export function probeRunActive(): boolean {
  return activeRun !== null;
}

export function activeProbeRun(): ProbeRun | null {
  return activeRun ? { ...activeRun } : null;
}

export function getProbeRun(): ProbeRun | null {
  return latestRun ? { ...latestRun } : null;
}

export function getProbeProgress(): { done: number; total: number; phase: ProbePhase } {
  const run = latestRun;
  return run
    ? { done: run.done, total: run.total, phase: run.phase }
    : { done: 0, total: 0, phase: "idle" };
}

/** Test-only reset for same-process test modules. */
export function __resetProbeRunState(): void {
  activeRun = null;
  latestRun = null;
  sequence = 0;
}
