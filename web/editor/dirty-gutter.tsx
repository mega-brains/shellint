import { RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import { diffLines } from "../diff/diff";
import { cmHost, cmRender } from "./cm-host";

/**
 * What changed since the last save, marked beside the line numbers, with each
 * run revertable on its own. The baseline is the saved file rather than a
 * commit: this editor's unit of "known good" is what is on disk, which is also
 * what Build and Check read.
 */
type Kind = "add" | "del" | "change";

/** Line offsets are 0-based half-open ranges: `a` is the baseline, `b` the doc. */
type Hunk = {
  kind: Kind;
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
};

/** Past this the per-keystroke diff stops being free, so markers are dropped. */
const MAX_CELLS = 400_000;

const setBaseline = StateEffect.define<string | null>();
const setSuspended = StateEffect.define<boolean>();

type DirtyState = {
  baseline: string[] | null;
  suspended: boolean;
  hunks: Hunk[];
};

function computeHunks(a: string[], b: string[]): Hunk[] {
  if (a.length * b.length > MAX_CELLS) return [];
  const lines = diffLines(a, b);
  const hunks: Hunk[] = [];
  let ai = 0;
  let bi = 0;

  for (let i = 0; i < lines.length; ) {
    if (lines[i].tag === " ") {
      ai += 1;
      bi += 1;
      i += 1;
      continue;
    }
    const aStart = ai;
    const bStart = bi;
    while (i < lines.length && lines[i].tag !== " ") {
      if (lines[i].tag === "-") ai += 1;
      else bi += 1;
      i += 1;
    }
    const kind: Kind = ai === aStart ? "add" : bi === bStart ? "del" : "change";
    hunks.push({ kind, aStart, aEnd: ai, bStart, bEnd: bi });
  }
  return hunks;
}

const LABEL: Record<Kind, string> = {
  add: "added",
  del: "removed",
  change: "changed",
};

/** What reverting would put back, and what it would take away. */
type Preview = { saved: string; current: string };

const TIP_LINES = 12;

let tip: HTMLElement | null = null;

function clip(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= TIP_LINES) return text;
  return [...lines.slice(0, TIP_LINES), `… ${lines.length - TIP_LINES} more`].join(
    "\n",
  );
}

function TipBlock(props: { label: string; text: string; cls: string }) {
  return (
    <div class="cm-dirty-tip-block">
      <p class="cm-dirty-tip-label">{props.label}</p>
      <pre class={`cm-dirty-tip-code ${props.cls}`}>{clip(props.text)}</pre>
    </div>
  );
}

function showTip(anchor: HTMLElement, hint: string, preview: Preview): void {
  if (!tip) {
    tip = cmHost("div", { class: "cm-dirty-tip", hidden: true });
    document.body.appendChild(tip);
  }
  cmRender(
    tip,
    <>
      <p class="cm-dirty-tip-head">{hint} · click to revert</p>
      {preview.current ? (
        <TipBlock label="now" text={preview.current} cls="cm-dirty-tip-now" />
      ) : null}
      {preview.saved ? (
        <TipBlock label="saved" text={preview.saved} cls="cm-dirty-tip-saved" />
      ) : null}
    </>,
  );

  const rect = anchor.getBoundingClientRect();
  tip.hidden = false;
  // Placed after unhiding, so the measured height is the real one.
  const height = tip.getBoundingClientRect().height;
  const top = Math.max(4, Math.min(rect.top, window.innerHeight - height - 4));
  tip.style.top = `${top}px`;
  tip.style.left = `${rect.right + 8}px`;
}

function hideTip(): void {
  if (tip) tip.hidden = true;
}

class DirtyMarker extends GutterMarker {
  constructor(
    private readonly kind: Kind,
    private readonly hint: string,
    private readonly preview: Preview = { saved: "", current: "" },
  ) {
    super();
  }

  override toDOM(): Node {
    const span = cmHost("span", {
      class: `cm-dirty cm-dirty-${this.kind}`,
      "aria-label": `${this.hint} since the last save`,
      children: this.kind === "del" ? "▔" : "▍",
    });
    const { hint, preview } = this;
    span.addEventListener("mouseenter", () => showTip(span, hint, preview));
    span.addEventListener("mouseleave", hideTip);
    return span;
  }
}

function textOf(doc: EditorView["state"]["doc"], from: number, to: number): string {
  const out: string[] = [];
  for (let n = from; n < Math.min(to, doc.lines); n++) {
    out.push(doc.line(n + 1).text);
  }
  return out.join("\n");
}

function markersFor(state: DirtyState, doc: EditorView["state"]["doc"]) {
  const ranges = [];
  for (const hunk of state.hunks) {
    const lines = hunk.aEnd - hunk.aStart || hunk.bEnd - hunk.bStart;
    const hint = `${lines} line${lines === 1 ? "" : "s"} ${LABEL[hunk.kind]}`;
    const preview: Preview = {
      saved: state.baseline?.slice(hunk.aStart, hunk.aEnd).join("\n") ?? "",
      current: textOf(doc, hunk.bStart, hunk.bEnd),
    };
    // A deletion has no line of its own, so it marks the line that took its
    // place — or the last line, when the tail of the file was deleted.
    const from = hunk.bStart;
    const to = hunk.kind === "del" ? hunk.bStart + 1 : hunk.bEnd;
    for (let n = from; n < to; n++) {
      const line = Math.min(n + 1, doc.lines);
      ranges.push(
        new DirtyMarker(hunk.kind, hint, preview).range(doc.line(line).from),
      );
    }
  }
  return RangeSet.of(ranges, true);
}

const dirtyField = StateField.define<DirtyState>({
  create: () => ({ baseline: null, suspended: false, hunks: [] }),
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setBaseline)) {
        next = { ...next, baseline: effect.value?.split("\n") ?? null };
      }
      if (effect.is(setSuspended)) next = { ...next, suspended: effect.value };
    }
    if (next === value && !tr.docChanged) return value;
    const hunks =
      next.baseline && !next.suspended
        ? computeHunks(next.baseline, tr.state.doc.toString().split("\n"))
        : [];
    return { ...next, hunks };
  },
});

/** Puts the baseline text back for the hunk the click landed on. */
function revertAt(view: EditorView, pos: number): boolean {
  const state = view.state.field(dirtyField);
  if (!state.baseline || state.suspended) return false;
  const doc = view.state.doc;
  const lineNo = doc.lineAt(pos).number - 1;

  const hunk = state.hunks.find((h) =>
    h.kind === "del"
      ? h.bStart === lineNo || (h.bStart >= doc.lines && lineNo === doc.lines - 1)
      : lineNo >= h.bStart && lineNo < h.bEnd,
  );
  if (!hunk) return false;

  const text = state.baseline.slice(hunk.aStart, hunk.aEnd).join("\n");

  if (hunk.kind === "del") {
    // Nothing to replace: put the missing lines back where they were.
    const atEnd = hunk.bStart >= doc.lines;
    const anchor = atEnd ? doc.line(doc.lines).to : doc.line(hunk.bStart + 1).from;
    view.dispatch({
      changes: {
        from: anchor,
        insert: atEnd ? `\n${text}` : `${text}\n`,
      },
    });
    return true;
  }

  const first = doc.line(hunk.bStart + 1);
  const last = doc.line(Math.min(hunk.bEnd, doc.lines));
  view.dispatch({
    changes: { from: first.from, to: last.to, insert: text },
  });
  return true;
}

export const dirtyGutter: Extension = [
  dirtyField,
  gutter({
    class: "cm-dirty-gutter",
    markers: (view) =>
      markersFor(view.state.field(dirtyField), view.state.doc),
    initialSpacer: () => new DirtyMarker("add", ""),
    domEventHandlers: {
      mousedown: (view, line, event) => {
        if (!revertAt(view, line.from)) return false;
        event.preventDefault();
        hideTip();
        return true;
      },
    },
  }),
];

/** The saved file — call after loading it and after every successful save. */
export function setDirtyBaseline(view: EditorView, source: string | null): void {
  view.dispatch({ effects: setBaseline.of(source) });
}

/** Artifact previews are a different file entirely, so the marks stand down. */
export function suspendDirty(view: EditorView, suspended: boolean): void {
  view.dispatch({ effects: setSuspended.of(suspended) });
}
