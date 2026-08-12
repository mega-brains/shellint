import { useCallback, useState } from "preact/hooks";
import { api } from "./api";
import { probeNote, type ProbeResult } from "./probe-logic";

export type UseProbe = {
  probeResults: ProbeResult[] | null;
  probeNoteText: string;
  probeProgress: { done: number; total: number } | null;
  probeDevice: () => Promise<void>;
};

/** Device capability probe: polls progress, then reports per-feature results. */
export function useProbe(
  setStatus: (msg: string, isError?: boolean) => void,
): UseProbe {
  const [probeResults, setProbeResults] = useState<ProbeResult[] | null>(null);
  const [probeNoteText, setProbeNoteText] = useState("not run yet");
  const [probeProgress, setProbeProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const probeDevice = useCallback(async () => {
    setProbeProgress({ done: 0, total: 0 });
    setStatus("probing…");
    const poll = setInterval(() => {
      void api<{ done: number; total: number }>("/api/probe/progress")
        .then((p) => {
          setProbeProgress({ done: p.done, total: p.total });
          const pct =
            p.total > 0
              ? Math.min(100, Math.round((p.done / p.total) * 100))
              : 0;
          setStatus(
            p.total > 0
              ? `probing… ${p.done}/${p.total} (${pct}%)`
              : "probing…",
          );
        })
        .catch(() => {});
    }, 300);
    try {
      const data = await api<{
        report: {
          scriptId: number;
          strategy: string;
          notes?: string[];
          results: ProbeResult[];
        };
      }>("/api/probe", { method: "POST", body: "{}" });
      const report = data.report;
      setProbeResults(report.results);
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
    } finally {
      clearInterval(poll);
      setProbeProgress(null);
    }
  }, [setStatus]);

  return { probeResults, probeNoteText, probeProgress, probeDevice };
}
