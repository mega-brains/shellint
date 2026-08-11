import { EditorView } from "codemirror";
import { HIGHLIGHT_LINES_EVENT, type LineHighlight } from "./line-highlight";

/**
 * Clicking a finding's location jumps the editor to that line. The check panel
 * only announces where the user wants to go; the artifact view listens, because
 * it is what owns which file the editor is showing.
 */
export type FindingLocation = { file: string; line: number };

export const SHOW_FILE_EVENT = "devroom:show-file";

/** Selects the whole line, so the jump target is visibly highlighted. */
export function revealLine(view: EditorView, line: number): void {
  const doc = view.state.doc;
  const target = doc.line(Math.min(Math.max(1, line), doc.lines));
  view.dispatch({
    selection: { anchor: target.from, head: target.to },
    effects: EditorView.scrollIntoView(target.from, { y: "center" }),
  });
  view.focus();
}

function emitHighlight(file: string, lines: number[]): void {
  document.dispatchEvent(
    new CustomEvent<LineHighlight>(HIGHLIGHT_LINES_EVENT, {
      detail: { file, lines, reveal: false },
    }),
  );
}

/** One delegated listener per findings list, however often it re-renders. */
const bound = new WeakSet<HTMLElement>();

export function bindFindingNavigation(list: HTMLElement): void {
  if (bound.has(list)) return;
  bound.add(list);

  list.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      "button.finding-loc",
    );
    if (!button) return;
    const { file, line } = button.dataset;
    if (!file || !line) return;
    document.dispatchEvent(
      new CustomEvent<FindingLocation>(SHOW_FILE_EVENT, {
        detail: { file, line: Number(line) },
      }),
    );
  });

  // Hover preview: tint the line without stealing selection or focus.
  list.addEventListener("pointerover", (e) => {
    const li = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      "li.finding",
    );
    if (!li || !list.contains(li)) return;
    const from = (e.relatedTarget as HTMLElement | null)?.closest("li.finding");
    if (from === li) return;
    const { file, line } = li.dataset;
    if (!file || !line) return;
    emitHighlight(file, [Number(line)]);
  });

  list.addEventListener("pointerout", (e) => {
    const li = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      "li.finding",
    );
    if (!li || !list.contains(li)) return;
    const to = (e.relatedTarget as HTMLElement | null)?.closest<HTMLElement>(
      "li.finding",
    );
    if (to === li) return;
    if (to && list.contains(to) && to.dataset.file && to.dataset.line) return;
    emitHighlight(li.dataset.file || "scripts/main.ts", []);
  });
}
