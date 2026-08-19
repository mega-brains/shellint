import { RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { Finding } from "../check/check-types";
import { cmHost, cmRender } from "./cm-host";

/**
 * Check findings as markers beside the line numbers. Which findings belong to
 * the buffer on screen is decided by the artifact view, since that is what
 * owns whether the editor shows the source or a built artifact.
 */
export const FINDINGS_EVENT = "shellint:findings";

const setFindings = StateEffect.define<Finding[]>();

/** One shared tip — native `title` lags; this shows on pointerenter. */
let tipEl: HTMLElement | null = null;

function tipHost(): HTMLElement {
  if (!tipEl) {
    tipEl = cmHost("div", { class: "cm-finding-tip", hidden: true });
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function hideTip(): void {
  if (tipEl) tipEl.hidden = true;
}

function showTip(anchor: HTMLElement, text: string, severity: Finding["severity"]): void {
  const el = tipHost();
  cmRender(el, text);
  el.classList.toggle("cm-finding-tip-error", severity === "error");
  el.hidden = false;
  const r = anchor.getBoundingClientRect();
  const pad = 8;
  el.style.left = `${Math.min(r.right + pad, window.innerWidth - el.offsetWidth - pad)}px`;
  el.style.top = `${Math.min(r.top, window.innerHeight - el.offsetHeight - pad)}px`;
}

class FindingMarker extends GutterMarker {
  constructor(
    private readonly severity: Finding["severity"],
    private readonly detail: string,
  ) {
    super();
  }

  override toDOM(): Node {
    const span = cmHost("span", {
      class: `cm-finding cm-finding-${this.severity}`,
      "aria-label": this.detail,
      children: this.severity === "error" ? "✕" : "⚠",
    });
    if (this.detail) {
      span.addEventListener("pointerenter", () => {
        showTip(span, this.detail, this.severity);
        // Span is mounted here; toDOM-time closest() would miss the scroller.
        span.closest(".cm-scroller")?.addEventListener("scroll", hideTip, {
          passive: true,
          once: true,
        });
      });
      span.addEventListener("pointerleave", hideTip);
    }
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
      const detail = list.map((f) => `${f.rule}: ${f.message}`).join("\n");
      return new FindingMarker(worst, detail).range(doc.line(line).from);
    });
  return RangeSet.of(ranges, true);
}

const findingField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setFindings)) {
        hideTip();
        set = build(tr.state.doc, effect.value);
      }
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
