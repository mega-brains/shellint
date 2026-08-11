import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "codemirror";
import {
  revealLine,
  SHOW_FILE_EVENT,
  type FindingLocation,
} from "./goto-finding";
import { FINDINGS_EVENT, showFindings } from "./finding-gutter";
import type { Finding } from "./check-panel";

export type ArtifactInfo = { name: string; bytes: number; mtime: string };

type ApiFn = <T>(
  path: string,
  init?: RequestInit,
) => Promise<T & { ok: boolean; error?: string }>;

/** Editor value that means "the editable source buffer", not an artifact. */
const SOURCE = "source";

/** Swapped between editable and read-only; main.ts seeds it empty. */
export const readOnlyCompartment = new Compartment();

const READ_ONLY = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];

/**
 * Previews the built dist artifacts in the editor, read-only. Owns its element
 * lookups so main.ts stays inside the 500-line source cap.
 */
export function createArtifactView(opts: {
  view: EditorView;
  api: ApiFn;
  onStatus: (msg: string, isError?: boolean) => void;
  /** Fires after entering or leaving preview, so the host can sync buttons. */
  onPreview: () => void;
}) {
  const select = document.getElementById("artifactSel") as HTMLSelectElement;
  const meta = document.getElementById("artifactMeta")!;

  /** What the editor currently shows: SOURCE, or an artifact name. */
  let current = SOURCE;
  /** Last check run, kept so switching files re-marks the new buffer. */
  let findings: Finding[] = [];
  /** The editable buffer — unsaved edits included — parked during a preview. */
  let sourceDoc: string | null = null;

  function setMeta(text: string, previewing: boolean) {
    meta.textContent = text;
    meta.classList.toggle("preview", previewing);
  }

  /** A finding belongs to the buffer on screen, or it is not shown at all. */
  function markFindings() {
    const file = current === SOURCE ? "scripts/main.ts" : `dist/${current}`;
    showFindings(
      opts.view,
      findings.filter((f) => f.file === file),
    );
  }

  function setDoc(text: string, readOnly: boolean) {
    opts.view.dispatch({
      changes: { from: 0, to: opts.view.state.doc.length, insert: text },
      effects: readOnlyCompartment.reconfigure(readOnly ? READ_ONLY : []),
    });
    opts.view.dom.classList.toggle("preview", readOnly);
    markFindings();
  }

  function restoreSource() {
    // Fall back to what is on screen only if nothing was ever parked.
    const doc = sourceDoc ?? opts.view.state.doc.toString();
    sourceDoc = null;
    current = SOURCE;
    setDoc(doc, false);
    select.value = SOURCE;
    setMeta("", false);
    opts.onPreview();
    opts.onStatus("editing scripts/main.ts");
  }

  function renderOptions(list: ArtifactInfo[]) {
    select.replaceChildren(new Option("source (editable)", SOURCE));
    for (const a of list) {
      select.append(new Option(`${a.name} · ${a.bytes} B`, a.name));
    }
    select.value = current;
  }

  async function show(name: string, force = false) {
    if (name === current && !force) return;
    if (name === SOURCE) return restoreSource();
    select.disabled = true;
    try {
      const data = await opts.api<{
        name: string;
        bytes: number;
        code: string;
      }>(`/api/artifact?name=${encodeURIComponent(name)}`);
      // Park the source only once the artifact is in hand, so a failed fetch
      // can never cost the user unsaved edits.
      if (current === SOURCE) sourceDoc = opts.view.state.doc.toString();
      current = name;
      setDoc(data.code, true);
      select.value = name;
      setMeta(`dist/${data.name} · ${data.bytes} B · generated`, true);
      opts.onPreview();
      opts.onStatus(`preview dist/${data.name} — build output, read-only`);
    } catch (e) {
      select.value = current;
      opts.onStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      select.disabled = false;
    }
  }

  /** Re-reads the artifact list, and the previewed artifact, after a build. */
  async function refresh() {
    let list: ArtifactInfo[];
    try {
      const data = await opts.api<{ artifacts: ArtifactInfo[] }>(
        "/api/artifacts",
      );
      list = data.artifacts;
    } catch {
      if (current === SOURCE) setMeta("artifact list unavailable", false);
      return;
    }
    renderOptions(list);
    if (current === SOURCE) {
      setMeta(list.length ? "" : "no build artifacts yet", false);
      return;
    }
    if (list.some((a) => a.name === current)) return show(current, true);
    restoreSource();
  }

  /**
   * A finding points at a file the editor may not be showing: dialect findings
   * live in a built artifact, lint findings in the source. Switch first, then
   * jump, so the line number always refers to what is on screen.
   */
  async function locate({ file, line }: FindingLocation) {
    const name = file.startsWith("dist/") ? file.slice("dist/".length) : SOURCE;
    try {
      await show(name);
    } catch {
      return;
    }
    revealLine(opts.view, line);
  }

  select.addEventListener("change", () => void show(select.value));
  document.addEventListener(SHOW_FILE_EVENT, (e) => {
    void locate((e as CustomEvent<FindingLocation>).detail);
  });
  document.addEventListener(FINDINGS_EVENT, (e) => {
    findings = (e as CustomEvent<Finding[]>).detail;
    markFindings();
  });
  void refresh();

  return { refresh, previewing: () => current !== SOURCE };
}
