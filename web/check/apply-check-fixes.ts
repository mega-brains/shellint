import type { EditorView } from "@codemirror/view";
import { setDirtyBaseline } from "../editor/dirty-gutter";
import { api } from "../lib/api";
import type { CheckFixPreview } from "./check-types";

export async function applyCheckFixes(
  fixes: CheckFixPreview,
  view: EditorView | null,
  markSaved: (source: string) => void,
  setStatus: (message: string) => void,
): Promise<void> {
  if (!view) throw new Error("editor unavailable");
  if (view.state.doc.toString() !== fixes.before) {
    throw new Error("source changed — run Check again");
  }
  await api("/api/script", {
    method: "PUT",
    body: JSON.stringify({ source: fixes.after }),
  });
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: fixes.after },
  });
  setDirtyBaseline(view, fixes.after);
  markSaved(fixes.after);
  setStatus(`applied ${fixes.count} automatic fix${fixes.count === 1 ? "" : "es"}`);
}
