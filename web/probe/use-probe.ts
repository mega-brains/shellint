import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../lib/api";
import { probeNote, type ProbeResult, type ProbeRunOptions } from "./probe-logic";

/** Where the run was stored on disk, and when — shown in the probe log. */
export type ProbeCapture = {
  ver: string | null;
  verKey: string;
  at: string;
  path: string;
};

export type UseProbe = {
  probeResults: ProbeResult[] | null;
  probeNoteText: string;
  probeProgress: ProbeProgress | null;
  probeCapture: ProbeCapture | null;
  probeDevice: (opts?: ProbeRunOptions) => Promise<void>;
};

export type ProbeProgress = {
  done: number;
  total: number;
  phase?: string;
  run?: { runId: string; error: string | null } | null;
};

type StoredCapture = {
  capture: ProbeCapture | null;
  report: {
    scriptId: number;
    strategy: string;
    results: ProbeResult[];
  } | null;
};

/**
 * Device capability probe: polls progress, then reports per-feature results.
 *
 * The results are also read back from the stored capture on mount and on every
 * device/slot switch, so a page reload does not empty the probe log — the run
 * itself is persisted server-side under `.shellint/devices/<id>/probes/`.
 */
export function useProbe(
  setStatus: (msg: string, isError?: boolean) => void,
  deviceId: string | null,
  sessionKey: number,
): UseProbe {
  const [probeResults, setProbeResults] = useState<ProbeResult[] | null>(null);
  const [probeNoteText, setProbeNoteText] = useState("not run yet");
  const [probeProgress, setProbeProgress] = useState<ProbeProgress | null>(null);
  const [probeCapture, setProbeCapture] = useState<ProbeCapture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const clear = (note: string) => {
      setProbeResults(null);
      setProbeCapture(null);
      setProbeNoteText(note);
    };
    void (async () => {
      if (!deviceId) {
        clear("no active device");
        return;
      }
      try {
        const data = await api<StoredCapture>(
          `/api/probe/last?device=${encodeURIComponent(deviceId)}`,
        );
        if (cancelled) return;
        if (!data.report) {
          clear("not run yet");
          return;
        }
        setProbeResults(data.report.results);
        setProbeCapture(data.capture);
        setProbeNoteText(
          probeNote(
            data.report.scriptId,
            data.report.strategy,
            data.report.results,
          ),
        );
      } catch {
        if (!cancelled) clear("not run yet");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId, sessionKey]);

  const probeDevice = useCallback(async (opts: ProbeRunOptions = {}) => {
    setProbeProgress({ done: 0, total: 0 });
    setStatus("probing…");
    let cancelled = false;
    let runId: string | null = null;
    const poll = setInterval(() => {
      void api<ProbeProgress>("/api/probe/progress")
        .then((p) => {
          if (cancelled) return;
          const nextRunId = p.run?.runId ?? null;
          if (runId && nextRunId !== runId) return;
          if (nextRunId) runId = nextRunId;
          setProbeProgress(p);
          if (p.phase === "failed") {
            setStatus(p.run?.error ?? "probe failed", true);
            return;
          }
          const pct =
            p.total > 0
              ? Math.min(100, Math.round((p.done / p.total) * 100))
              : 0;
          const phase = p.phase && p.phase !== "probing" ? ` ${p.phase}` : "";
          setStatus(p.total > 0 ? `probing…${phase} ${p.done}/${p.total} (${pct}%)` : `probing…${phase}`);
        })
        .catch(() => {});
    }, 300);
    try {
      const data = await api<{
        capture: ProbeCapture | null;
        report: {
          scriptId: number;
          strategy: string;
          notes?: string[];
          results: ProbeResult[];
        };
      }>("/api/probe", { method: "POST", body: JSON.stringify(opts) });
      const report = data.report;
      setProbeResults(report.results);
      setProbeCapture(data.capture ?? null);
      setProbeNoteText(
        probeNote(report.scriptId, report.strategy, report.results),
      );
      const lines = report.results.map((r) =>
        r.ok
          ? `${r.id}: ${JSON.stringify(r.result)}`
          : `${r.id}: FAIL ${r.error}`,
      );
      setStatus(
        [
          `probe written to types/generated-probe.json · slot ${report.scriptId} (${report.strategy})`,
          ...(report.notes ?? []),
          ...lines,
        ].join("\n"),
      );
    } catch (e) {
      setProbeProgress(null);
      throw e;
    } finally {
      cancelled = true;
      clearInterval(poll);
      setProbeProgress(null);
    }
  }, [setStatus]);

  return { probeResults, probeNoteText, probeProgress, probeCapture, probeDevice };
}
