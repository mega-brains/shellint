import { RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { Finding } from "./check-panel";

/**
 * Check findings as markers beside the line numbers. Which findings belong to
 * the buffer on screen is decided by the artifact view, since that is what
 * owns whether the editor shows the source or a built artifact.
 */
export const FINDINGS_EVENT = "devroom:findings";

const setFindings = StateEffect.define<Finding[]>();

class FindingMarker extends GutterMarker {
  constructor(
    private readonly severity: Finding["severity"],
    private readonly title: string,
  ) {
    super();
  }

  override toDOM(): Node {
    const span = document.createElement("span");
    span.className = `cm-finding cm-finding-${this.severity}`;
    span.textContent = this.severity === "error" ? "✕" : "⚠";
    span.title = this.title;
    return span;
  }
}

/** One marker per line: several findings on a line merge into one tooltip. */
function build(doc: EditorView["state"]["doc"], findings: Finding[]) {
  const byLine = new Map<number, Finding[]>();
  for (const f of findings) {
    if (f.line == null) continue;
    const line = Math.min(Math.max(1, f.line), doc.lines);
    byLine.set(line, [...(byLine.get(line) ?? []), f]);
  }

  const ranges = [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, list]) => {
      const worst = list.some((f) => f.severity === "error") ? "error" : "warn";
      const title = list.map((f) => `${f.rule}: ${f.message}`).join("\n");
      return new FindingMarker(worst, title).range(doc.line(line).from);
    });
  return RangeSet.of(ranges, true);
}

const findingField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setFindings)) set = build(tr.state.doc, effect.value);
    }
    return set;
  },
});

export const findingGutter: Extension = [
  findingField,
  gutter({
    class: "cm-finding-gutter",
    markers: (view) => view.state.field(findingField),
    initialSpacer: () => new FindingMarker("warn", ""),
  }),
];

export function showFindings(view: EditorView, findings: Finding[]): void {
  view.dispatch({ effects: setFindings.of(findings) });
}
