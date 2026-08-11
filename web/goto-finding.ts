import { EditorView } from "codemirror";

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
}
