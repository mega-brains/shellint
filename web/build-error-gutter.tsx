import { RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from "@codemirror/view";
import { cmHost } from "./cm-host";

/** One `tsc` diagnostic, 1-indexed line/col as reported on the CLI. */
export type BuildError = {
  line: number;
  col: number;
  code: string;
  message: string;
};

const TSC_LINE = /scripts\/main\.ts\((\d+),(\d+)\): error (TS\d+): (.+)/g;

/** Parses `tsc`'s `file(line,col): error TSxxxx: message` lines out of build stderr/stdout. */
export function parseTscErrors(text: string): BuildError[] {
  const errors: BuildError[] = [];
  for (const m of text.matchAll(TSC_LINE)) {
    errors.push({
      line: Number(m[1]),
      col: Number(m[2]),
      code: m[3],
      message: m[4].trim(),
    });
  }
  return errors;
}

const setErrors = StateEffect.define<BuildError[]>();

class BuildErrorMarker extends GutterMarker {
  constructor(private readonly detail: string) {
    super();
  }

  override toDOM(): Node {
    return cmHost("span", {
      class: "cm-build-error-marker",
      "aria-label": this.detail,
      title: this.detail,
      children: "✕",
    });
  }
}

const WORD_CHAR = /[A-Za-z0-9_$]/;

/** Underline from the reported column to the end of that identifier (min 1 char). */
function tokenEnd(lineText: string, fromCol: number): number {
  let end = fromCol;
  if (WORD_CHAR.test(lineText[end] ?? "")) {
    while (end < lineText.length && WORD_CHAR.test(lineText[end])) end++;
  } else {
    end = fromCol + 1;
  }
  return end;
}

function build(doc: EditorView["state"]["doc"], errors: BuildError[]) {
  const byLine = new Map<number, BuildError[]>();
  for (const e of errors) {
    if (e.line < 1 || e.line > doc.lines) continue;
    byLine.set(e.line, [...(byLine.get(e.line) ?? []), e]);
  }

  const markers: ReturnType<GutterMarker["range"]>[] = [];
  const underlines: ReturnType<Decoration["range"]>[] = [];
  for (const [line, list] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    const lineObj = doc.line(line);
    const detail = list.map((e) => `${e.code}: ${e.message}`).join("\n");
    markers.push(new BuildErrorMarker(detail).range(lineObj.from));

    for (const e of list) {
      const fromCol = Math.max(0, e.col - 1);
      const from = Math.min(lineObj.from + fromCol, lineObj.to);
      const to = Math.min(lineObj.from + tokenEnd(lineObj.text, fromCol), lineObj.to);
      if (to > from) {
        underlines.push(
          Decoration.mark({ class: "cm-build-error-underline", attributes: { title: detail } }).range(
            from,
            to,
          ),
        );
      }
    }
  }

  return {
    markers: RangeSet.of(markers, true),
    underlines: Decoration.set(underlines, true),
  };
}

const buildErrorField = StateField.define<{
  markers: RangeSet<GutterMarker>;
  underlines: DecorationSet;
}>({
  create: () => ({ markers: RangeSet.empty, underlines: Decoration.none }),
  update(value, tr) {
    let { markers, underlines } = value;
    markers = markers.map(tr.changes);
    underlines = underlines.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setErrors)) ({ markers, underlines } = build(tr.state.doc, effect.value));
    }
    return { markers, underlines };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.underlines),
});

export const buildErrorGutter: Extension = [
  buildErrorField,
  gutter({
    class: "cm-build-error-gutter",
    markers: (view) => view.state.field(buildErrorField).markers,
  }),
];

export function showBuildErrors(view: EditorView, errors: BuildError[]): void {
  view.dispatch({ effects: setErrors.of(errors) });
}

export function clearBuildErrors(view: EditorView): void {
  if (view.state.field(buildErrorField).markers.size) showBuildErrors(view, []);
}

/** Pulls `tsc` diagnostics out of a thrown build error, marks them in the editor, and rethrows. */
export function reportBuildFailure(view: EditorView, e: unknown): never {
  const errors = parseTscErrors(e instanceof Error ? e.message : String(e));
  if (errors.length) showBuildErrors(view, errors);
  throw e;
}
