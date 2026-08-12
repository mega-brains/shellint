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
import { suspendDirty } from "./dirty-gutter";
import type { Finding } from "./check-panel";
import type { DiffOption } from "./diff-modal";

export type ArtifactInfo = { name: string; bytes: number; mtime: string };
export type ArtifactOption = { value: string; label: string };

type ApiFn = <T>(
  path: string,
  init?: RequestInit,
) => Promise<T & { ok: boolean; error?: string }>;

const SOURCE = "source";
const DIFF = "diff:debug↔prod";
const DIFF_SIDE = "diff:side-by-side";
const DIFF_SRC = "diff:source-vs-prod";
const DIFF_LEFT = "debug.raw.js";
const DIFF_RIGHT = "prod.raw.js";

export const readOnlyCompartment = new Compartment();

const READ_ONLY = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];

export type ArtifactController = {
  refresh: () => Promise<void>;
  previewing: () => boolean;
  select: (name: string) => void;
  loadDiff: (id: string) => Promise<string>;
  dispose: () => void;
};

/**
 * Previews built dist artifacts in the editor (read-only). UI chrome is owned
 * by Preact; this controller only mutates the CodeMirror doc and reports state.
 */
export function createArtifactController(opts: {
  view: EditorView;
  api: ApiFn;
  onStatus: (msg: string, isError?: boolean) => void;
  onPreview: () => void;
  onMeta: (text: string, previewing: boolean) => void;
  onOptions: (options: ArtifactOption[], current: string) => void;
  onDiff: (spec: {
    options: DiffOption[];
    left: string;
    right: string;
  }) => void;
}): ArtifactController {
  let current = SOURCE;
  let findings: Finding[] = [];
  let sourceDoc: string | null = null;
  let known: ArtifactInfo[] = [];
  let disposed = false;

  function setMeta(text: string, previewing: boolean) {
    opts.onMeta(text, previewing);
  }

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
    highlightLines(opts.view, []);
    showDiffTint(opts.view, false);
    suspendDirty(opts.view, readOnly);
  }

  function restoreSource() {
    const doc = sourceDoc ?? opts.view.state.doc.toString();
    sourceDoc = null;
    current = SOURCE;
    setDoc(doc, false);
    publishOptions();
    setMeta("", false);
    opts.onPreview();
    opts.onStatus("editing scripts/main.ts");
  }

  function buildOptions(list: ArtifactInfo[]): ArtifactOption[] {
    const out: ArtifactOption[] = [
      { value: SOURCE, label: "source (editable)" },
    ];
    for (const a of list) {
      out.push({ value: a.name, label: `${a.name} · ${a.bytes} B` });
    }
    const has = (name: string) => list.some((a) => a.name === name);
    if (has(DIFF_LEFT) && has(DIFF_RIGHT)) {
      out.push({ value: DIFF, label: "diff · debug ↔ prod (raw)" });
      out.push({ value: DIFF_SIDE, label: "diff · side by side ⤢" });
    }
    if (has(DIFF_RIGHT)) {
      out.push({ value: DIFF_SRC, label: "diff · source ↔ prod.raw ⤢" });
    }
    return out;
  }

  function publishOptions() {
    opts.onOptions(buildOptions(known), current);
  }

  async function fetchArtifact(name: string) {
    return opts.api<{ name: string; bytes: number; code: string }>(
      `/api/artifact?name=${encodeURIComponent(name)}`,
    );
  }

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
    publishOptions();
    const churn = `+${diff.added} −${diff.removed}`;
    setMeta(`${DIFF_LEFT} → ${DIFF_RIGHT} · ${churn}`, true);
    opts.onPreview();
    opts.onStatus(
      `diff ${DIFF_LEFT} → ${DIFF_RIGHT} · ${churn} — what meta.env gating changed`,
    );
  }

  function sourceText(): string {
    return current === SOURCE
      ? opts.view.state.doc.toString()
      : (sourceDoc ?? "");
  }

  function openSideBySide(left: string, right: string) {
    opts.onDiff({
      options: [
        { id: SOURCE, label: "scripts/main.ts (editor)" },
        ...known.map((a) => ({ id: a.name, label: `dist/${a.name}` })),
      ],
      left,
      right,
    });
    publishOptions();
    opts.onStatus(`side-by-side diff ${left} → ${right}`);
  }

  async function show(name: string, force = false) {
    if (name === current && !force) return;
    if (name === SOURCE) return restoreSource();
    try {
      if (name === DIFF_SRC) return openSideBySide(SOURCE, DIFF_RIGHT);
      if (name === DIFF_SIDE) return openSideBySide(DIFF_LEFT, DIFF_RIGHT);
      if (name === DIFF) return await showDiff();
      const data = await opts.api<{
        name: string;
        bytes: number;
        code: string;
      }>(`/api/artifact?name=${encodeURIComponent(name)}`);
      if (current === SOURCE) sourceDoc = opts.view.state.doc.toString();
      current = name;
      setDoc(data.code, true);
      publishOptions();
      setMeta(`dist/${data.name} · ${data.bytes} B · generated`, true);
      opts.onPreview();
      opts.onStatus(`preview dist/${data.name} — build output, read-only`);
    } catch (e) {
      publishOptions();
      opts.onStatus(e instanceof Error ? e.message : String(e), true);
    }
  }

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
    known = list;
    publishOptions();
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

  async function locate({ file, line }: FindingLocation) {
    const name = file.startsWith("dist/") ? file.slice("dist/".length) : SOURCE;
    try {
      await show(name);
    } catch {
      return;
    }
    revealLine(opts.view, line);
  }

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
    revealLine(opts.view, Math.min(...lines));
  }

  const onShowFile = (e: Event) => {
    void locate((e as CustomEvent<FindingLocation>).detail);
  };
  const onHighlight = (e: Event) => {
    void locateLines((e as CustomEvent<LineHighlight>).detail);
  };
  const onFindings = (e: Event) => {
    findings = (e as CustomEvent<Finding[]>).detail;
    markFindings();
  };

  document.addEventListener(SHOW_FILE_EVENT, onShowFile);
  document.addEventListener(HIGHLIGHT_LINES_EVENT, onHighlight);
  document.addEventListener(FINDINGS_EVENT, onFindings);
  void refresh();

  return {
    refresh,
    previewing: () => current !== SOURCE,
    select: (name: string) => {
      void show(name);
    },
    loadDiff: async (id: string) =>
      id === SOURCE ? sourceText() : (await fetchArtifact(id)).code,
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener(SHOW_FILE_EVENT, onShowFile);
      document.removeEventListener(HIGHLIGHT_LINES_EVENT, onHighlight);
      document.removeEventListener(FINDINGS_EVENT, onFindings);
    },
  };
}
