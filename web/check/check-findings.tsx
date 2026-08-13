import { useEffect, useState } from "preact/hooks";
import { FINDINGS_EVENT } from "../editor/finding-gutter";
import {
  SHOW_FILE_EVENT,
  type FindingLocation,
} from "../editor/goto-finding";
import { HIGHLIGHT_LINES_EVENT, type LineHighlight } from "../editor/line-highlight";
import {
  findingLocation,
  findingsAsText,
  sortFindings,
  type Finding,
} from "./check-types";

function emitHighlight(file: string, lines: number[]) {
  document.dispatchEvent(
    new CustomEvent<LineHighlight>(HIGHLIGHT_LINES_EVENT, {
      detail: { file, lines, reveal: false },
    }),
  );
}

function goToFinding(file: string, line: number) {
  document.dispatchEvent(
    new CustomEvent<FindingLocation>(SHOW_FILE_EVENT, {
      detail: { file, line },
    }),
  );
}

export function CopyFindingsButton(props: { findings: Finding[] }) {
  const ordered = sortFindings(props.findings);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      class={`copy-findings${copied ? " copied" : ""}`}
      id="copyFindings"
      title="Copy all findings to clipboard"
      hidden={ordered.length === 0}
      onClick={() => {
        void navigator.clipboard.writeText(findingsAsText(ordered)).then(() => {
          setCopied(true);
        });
      }}
    >
      {copied ? "⧉ copied" : "⧉ copy"}
    </button>
  );
}

export function FindingsList(props: { findings: Finding[] }) {
  const ordered = sortFindings(props.findings);

  useEffect(() => {
    document.dispatchEvent(
      new CustomEvent<Finding[]>(FINDINGS_EVENT, { detail: props.findings }),
    );
  }, [props.findings]);

  return (
    <ol class="findings-list" id="findingsList">
      {ordered.map((f, i) => {
        const where = findingLocation(f);
        const isError = f.severity === "error";
        return (
          <li
            key={`${f.rule}:${f.line ?? i}:${f.message}`}
            class={`finding ${f.severity}`}
            data-file={f.file}
            data-line={f.line != null ? String(f.line) : undefined}
            onPointerOver={(e) => {
              if (!f.file || f.line == null) return;
              const from = (e.relatedTarget as HTMLElement | null)?.closest(
                "li.finding",
              );
              if (from === e.currentTarget) return;
              emitHighlight(f.file, [f.line]);
            }}
            onPointerOut={(e) => {
              if (!f.file || f.line == null) return;
              const to = (e.relatedTarget as HTMLElement | null)?.closest(
                "li.finding",
              ) as HTMLElement | null;
              if (to === e.currentTarget) return;
              if (
                to &&
                e.currentTarget.parentElement?.contains(to) &&
                to.dataset.file &&
                to.dataset.line
              ) {
                return;
              }
              emitHighlight(f.file, []);
            }}
          >
            <span class="finding-head">
              <span
                class={`badge ${isError ? "badge-fail" : "badge-warn"} finding-sev`}
              >
                {isError ? "ERROR" : "WARN"}
              </span>
              <span class="finding-rule">{f.rule}</span>
              {where ? (
                f.line != null && f.file ? (
                  <button
                    type="button"
                    class="finding-loc"
                    data-file={f.file}
                    data-line={String(f.line)}
                    title={`Go to ${where}`}
                    onClick={() => goToFinding(f.file!, f.line!)}
                  >
                    <span class="finding-loc-sev" aria-hidden="true">
                      {isError ? "✕" : "⚠"}
                    </span>
                    <span class="finding-loc-text">{where}</span>
                    <span class="finding-loc-go" aria-hidden="true">
                      ↗
                    </span>
                  </button>
                ) : (
                  <span class="finding-loc">
                    <span class="finding-loc-sev" aria-hidden="true">
                      {isError ? "✕" : "⚠"}
                    </span>
                    <span class="finding-loc-text">{where}</span>
                  </span>
                )
              ) : null}
            </span>
            <span class="finding-msg">{f.message}</span>
          </li>
        );
      })}
    </ol>
  );
}
