import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "codemirror";
import {
  revealLine,
  SHOW_FILE_EVENT,
  type FindingLocation,
} from "./goto-finding";
import { FINDINGS_EVENT, showFindings } from "./finding-gutter";
import {
  HIGHLIGHT_LINES_EVENT,
  highlightLines,
  type LineHighlight,
} from "./line-highlight";
import { showDiffTint, unifiedDiff } from "./diff";
import { openDiffModal } from "./diff-modal";
import { suspendDirty } from "./dirty-gutter";
import type { Finding } from "./check-panel";

export type ArtifactInfo = { name: string; bytes: number; mtime: string };

type ApiFn = <T>(
  path: string,
  init?: RequestInit,
) => Promise<T & { ok: boolean; error?: string }>;

/** Editor value that means "the editable source buffer", not an artifact. */
const SOURCE = "source";

/**
 * What `meta.env` gating actually removed, as a diff in the same selector. The
 * readable artifacts are the only pair worth diffing — the minified ones are a
 * single line each, so their diff says nothing a byte count does not.
 */
const DIFF = "diff:debug↔prod";
/** Same pair, but two columns in a modal instead of one buffer in the editor. */
const DIFF_SIDE = "diff:side-by-side";
/** What the compiler did to the code in the editor, TypeScript against ES5. */
const DIFF_SRC = "diff:source-vs-prod";
const DIFF_LEFT = "debug.raw.js";
const DIFF_RIGHT = "prod.raw.js";

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
  /** Last artifact listing, so the diff modal can offer every built version. */
  let known: ArtifactInfo[] = [];

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
    // Badge lines belong to the buffer they were counted in, not this one.
    highlightLines(opts.view, []);
    showDiffTint(opts.view, false);
    suspendDirty(opts.view, readOnly);
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
    known = list;
    select.replaceChildren(new Option("source (editable)", SOURCE));
    for (const a of list) {
      select.append(new Option(`${a.name} · ${a.bytes} B`, a.name));
    }
    const has = (name: string) => list.some((a) => a.name === name);
    if (has(DIFF_LEFT) && has(DIFF_RIGHT)) {
      select.append(new Option(`diff · debug ↔ prod (raw)`, DIFF));
      select.append(new Option(`diff · side by side ⤢`, DIFF_SIDE));
    }
    if (has(DIFF_RIGHT)) {
      select.append(new Option(`diff · source ↔ prod.raw ⤢`, DIFF_SRC));
    }
    select.value = current;
  }

  async function fetchArtifact(name: string) {
    return opts.api<{ name: string; bytes: number; code: string }>(
      `/api/artifact?name=${encodeURIComponent(name)}`,
    );
  }

  /** Both artifacts, diffed in the browser — the server has no diff endpoint. */
  async function showDiff() {
    const [left, right] = await Promise.all([
      fetchArtifact(DIFF_LEFT),
      fetchArtifact(DIFF_RIGHT),
    ]);
    const diff = unifiedDiff(left, right);
    if (current === SOURCE) sourceDoc = opts.view.state.doc.toString();
    current = DIFF;
    setDoc(diff.text, true);
    showDiffTint(opts.view, true);
    select.value = DIFF;
    const churn = `+${diff.added} −${diff.removed}`;
    setMeta(`${DIFF_LEFT} → ${DIFF_RIGHT} · ${churn}`, true);
    opts.onPreview();
    opts.onStatus(
      `diff ${DIFF_LEFT} → ${DIFF_RIGHT} · ${churn} — what meta.env gating changed`,
    );
  }

  /**
   * The editable buffer, unsaved edits included, since that is the code the
   * user is reasoning about rather than whatever was last written to disk.
   */
  function sourceText(): string {
    return current === SOURCE
      ? opts.view.state.doc.toString()
      : (sourceDoc ?? "");
  }

  /**
   * A popup, not a buffer: what the editor shows is left exactly as it was.
   * Both sides are pickable inside it, so this only chooses where to start.
   */
  function openSideBySide(left: string, right: string) {
    openDiffModal({
      options: [
        { id: SOURCE, label: "scripts/main.ts (editor)" },
        ...known.map((a) => ({ id: a.name, label: `dist/${a.name}` })),
      ],
      left,
      right,
      load: async (id) =>
        id === SOURCE ? sourceText() : (await fetchArtifact(id)).code,
    });
    select.value = current;
    opts.onStatus(`side-by-side diff ${left} → ${right}`);
  }

  async function show(name: string, force = false) {
    if (name === current && !force) return;
    if (name === SOURCE) return restoreSource();
    select.disabled = true;
    try {
      if (name === DIFF_SRC) return openSideBySide(SOURCE, DIFF_RIGHT);
      if (name === DIFF_SIDE) return openSideBySide(DIFF_LEFT, DIFF_RIGHT);
      if (name === DIFF) return await showDiff();
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
    const stillThere =
      current === DIFF
        ? list.some((a) => a.name === DIFF_LEFT) &&
          list.some((a) => a.name === DIFF_RIGHT)
        : list.some((a) => a.name === current);
    if (stillThere) return show(current, true);
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

  /** A badge click: same switch-then-show dance as a finding, many lines. */
  async function locateLines({ file, lines, reveal = true }: LineHighlight) {
    if (!lines.length) {
      highlightLines(opts.view, []);
      return;
    }
    const name = file.startsWith("dist/") ? file.slice("dist/".length) : SOURCE;
    try {
      await show(name);
    } catch {
      return;
    }
    highlightLines(opts.view, lines);
    if (!reveal) return;
    const first = Math.min(...lines);
    revealLine(opts.view, first);
  }

  select.addEventListener("change", () => void show(select.value));
  document.addEventListener(SHOW_FILE_EVENT, (e) => {
    void locate((e as CustomEvent<FindingLocation>).detail);
  });
  document.addEventListener(HIGHLIGHT_LINES_EVENT, (e) => {
    void locateLines((e as CustomEvent<LineHighlight>).detail);
  });
  document.addEventListener(FINDINGS_EVENT, (e) => {
    findings = (e as CustomEvent<Finding[]>).detail;
    markFindings();
  });
  void refresh();

  return { refresh, previewing: () => current !== SOURCE };
}
