import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * Transient line highlight for "show me where this number comes from" jumps
 * from the dashboard badges. Like the finding gutter, the artifact view decides
 * which buffer the lines belong to, since it owns what the editor shows.
 */
export const HIGHLIGHT_LINES_EVENT = "devroom:highlight-lines";

export type LineHighlight = {
  file: string;
  lines: number[];
  /** Select + scroll to the first line. Default true; hover previews pass false. */
  reveal?: boolean;
};

const setLines = StateEffect.define<number[]>();

const lineDeco = Decoration.line({ class: "cm-stat-line" });

function build(doc: EditorView["state"]["doc"], lines: number[]): DecorationSet {
  const uniq = [...new Set(lines)]
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.min(Math.max(1, n), doc.lines))
    .sort((a, b) => a - b);
  return Decoration.set(
    [...new Set(uniq)].map((n) => lineDeco.range(doc.line(n).from)),
    true,
  );
}

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setLines)) set = build(tr.state.doc, effect.value);
    }
    return set;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const statLineHighlight: Extension = [highlightField];

export function highlightLines(view: EditorView, lines: number[]): void {
  view.dispatch({ effects: setLines.of(lines) });
}

export function clearHighlight(view: EditorView): void {
  if (view.state.field(highlightField).size) highlightLines(view, []);
}
