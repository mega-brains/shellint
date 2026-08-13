import { EditorView } from "@codemirror/view";

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
