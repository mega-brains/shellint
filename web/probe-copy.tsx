import { useEffect, useState } from "preact/hooks";
import { probeAvailable, type ProbeResult } from "./probe-logic";

export type ProbeFormat = "txt" | "csv" | "json";

function cell(r: ProbeResult): string {
  return r.ok ? JSON.stringify(r.result) : `FAIL ${r.error ?? ""}`;
}

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** The visible probe rows, in one of three plain-text shapes. */
export function formatProbeResults(
  results: ProbeResult[],
  format: ProbeFormat,
): string {
  if (format === "json") return JSON.stringify(results, null, 2);
  if (format === "csv") {
    const rows = results.map((r) =>
      [
        r.id,
        probeAvailable(r) ? "available" : "unavailable",
        r.ok ? "ok" : "error",
        r.ok ? JSON.stringify(r.result ?? null) : "",
        r.ok ? "" : (r.error ?? ""),
      ]
        .map(csvField)
        .join(","),
    );
    return ["id,status,rpc,result,error", ...rows].join("\n");
  }
  const width = results.reduce((w, r) => Math.max(w, r.id.length), 0);
  return results
    .map((r) => `${r.id.padEnd(width)}  ${cell(r)}`)
    .join("\n");
}

/** txt / csv / json copy buttons for the probe log. Copies what is filtered in. */
export function ProbeCopyButtons(props: { results: ProbeResult[] }) {
  const [copied, setCopied] = useState<ProbeFormat | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  const disabled = props.results.length === 0;

  return (
    <div class="probe-log-note probe-copy-row" id="probeCopyRow">
      <span>copy</span>
      {(["txt", "csv", "json"] as ProbeFormat[]).map((f) => (
        <button
          key={f}
          type="button"
          id={`probeCopy-${f}`}
          class={`probe-log-quick probe-copy${copied === f ? " copied" : ""}`}
          title={`Copy the listed probe results as ${f.toUpperCase()}`}
          disabled={disabled}
          onClick={() => {
            void navigator.clipboard
              .writeText(formatProbeResults(props.results, f))
              .then(() => setCopied(f));
          }}
        >
          {copied === f ? `⧉ ${f} ✓` : `⧉ ${f}`}
        </button>
      ))}
    </div>
  );
}
