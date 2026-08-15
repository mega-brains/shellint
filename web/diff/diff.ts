import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * Unified diff of two build artifacts, so the effect of `meta.env` gating is
 * readable rather than inferred from two byte counts. Hand-rolled for the same
 * reason the charts are: the artifacts are small and a dependency is not.
 */
export type DiffTag = " " | "+" | "-";
export type DiffLine = { tag: DiffTag; text: string };

const CONTEXT = 3;

/** Classic LCS table. Fine for the raw artifacts — hundreds of lines, not millions. */
function lcs(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

export function diffLines(a: string[], b: string[]): DiffLine[] {
  const table = lcs(a, b);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ tag: " ", text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ tag: "-", text: a[i++] });
    } else {
      out.push({ tag: "+", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ tag: "-", text: a[i++] });
  while (j < b.length) out.push({ tag: "+", text: b[j++] });
  return out;
}

/** Runs of context around each change, so unchanged bulk is not reprinted. */
function hunks(lines: DiffLine[]): DiffLine[] {
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (line.tag === " ") return;
    for (let k = i - CONTEXT; k <= i + CONTEXT; k++) {
      if (k >= 0 && k < lines.length) keep.add(k);
    }
  });

  const out: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    if (keep.has(i)) {
      if (skipped) {
        out.push({ tag: " ", text: `@@ ${skipped} unchanged line(s) @@` });
        skipped = 0;
      }
      out.push(line);
      return;
    }
    skipped += 1;
  });
  if (skipped) {
    out.push({ tag: " ", text: `@@ ${skipped} unchanged line(s) @@` });
  }
  return out;
}

/* --- Word-level diff, for two lines that were paired as a change ----------- */

export type Segment = { text: string; changed: boolean };

/** Words, runs of whitespace and single punctuation each count as one token. */
function tokenize(line: string): string[] {
  return line.match(/\s+|[A-Za-z0-9_$]+|[^\s\w]/g) ?? [];
}

/** Past this, an intra-line diff is slower than it is useful — minified code. */
const WORD_DIFF_LIMIT = 2000;
/** Below this share of shared tokens the lines are different, not edited. */
const SIMILAR_ENOUGH = 0.4;

function join(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && last.changed === s.changed) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

/**
 * Which words actually differ between a removed line and the line that
 * replaced it. Falls back to "the whole line changed" when the two are too
 * unalike for a word diff to mean anything.
 */
export function wordDiff(
  left: string,
  right: string,
): { left: Segment[]; right: Segment[] } | null {
  if (left.length > WORD_DIFF_LIMIT || right.length > WORD_DIFF_LIMIT) {
    return null;
  }
  const a = tokenize(left);
  const b = tokenize(right);
  if (!a.length || !b.length) return null;

  const lines = diffLines(a, b);
  const same = lines.filter((l) => l.tag === " ");
  const shared = same.reduce((n, l) => n + l.text.trim().length, 0);
  const total = left.trim().length + right.trim().length;
  if (!total || (shared * 2) / total < SIMILAR_ENOUGH) return null;

  return {
    left: join(
      lines
        .filter((l) => l.tag !== "+")
        .map((l) => ({ text: l.text, changed: l.tag === "-" })),
    ),
    right: join(
      lines
        .filter((l) => l.tag !== "-")
        .map((l) => ({ text: l.text, changed: l.tag === "+" })),
    ),
  };
}

export type DiffResult = { text: string; added: number; removed: number };

export function unifiedDiff(
  left: { name: string; code: string },
  right: { name: string; code: string },
): DiffResult {
  const lines = diffLines(left.code.split("\n"), right.code.split("\n"));
  const added = lines.filter((l) => l.tag === "+").length;
  const removed = lines.filter((l) => l.tag === "-").length;
  const body = hunks(lines).map((l) => `${l.tag}${l.text}`);
  return {
    text: [`--- dist/${left.name}`, `+++ dist/${right.name}`, ...body].join("\n"),
    added,
    removed,
  };
}

/* --- Editor tinting for the diff buffer ------------------------------------ */

const setDiff = StateEffect.define<boolean>();

const DECO: Record<string, Decoration> = {
  "+": Decoration.line({ class: "cm-diff-add" }),
  "-": Decoration.line({ class: "cm-diff-del" }),
  "@": Decoration.line({ class: "cm-diff-meta" }),
};

/**
 * The leading ± is the one add/remove cue that survives a red/green colour
 * deficiency, but as plain document text it is just another character in the
 * line. Marking it lets the stylesheet give it weight and full contrast.
 */
const MARK: Record<string, Decoration> = {
  "+": Decoration.mark({ class: "cm-diff-mark" }),
  "-": Decoration.mark({ class: "cm-diff-mark" }),
};

function keyFor(text: string, isHeader: boolean): string {
  if (isHeader) return "@";
  if (text.startsWith(" @@")) return "@";
  return text.slice(0, 1);
}

function build(state: EditorView["state"]): DecorationSet {
  const ranges: ReturnType<Decoration["range"]>[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const key = keyFor(line.text, n <= 2);
    const deco = DECO[key];
    if (!deco) continue;
    ranges.push(deco.range(line.from));
    const mark = MARK[key];
    if (mark && line.to > line.from) {
      ranges.push(mark.range(line.from, line.from + 1));
    }
  }
  return Decoration.set(ranges, true);
}

const diffField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setDiff)) set = effect.value ? build(tr.state) : Decoration.none;
    }
    return set;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const diffHighlight: Extension = [diffField];

/**
 * `cm-diff-doc` on the editor is what lets the stylesheet flatten the syntax
 * highlighter over a patch. A unified diff is not JavaScript — the ± column
 * derails the parser, so those colours are noise, and they are also the reason
 * text on a tinted line could not be held to a contrast floor: three of the
 * light-theme token colours only clear AA against plain white.
 */
export function showDiffTint(view: EditorView, on: boolean): void {
  view.dom.classList.toggle("cm-diff-doc", on);
  view.dispatch({ effects: setDiff.of(on) });
}
