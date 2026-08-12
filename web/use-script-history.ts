import { useCallback, useState } from "preact/hooks";
import type { EditorView } from "@codemirror/view";
import { api } from "./api";
import { setDirtyBaseline } from "./dirty-gutter";
import type { ScriptHistoryRow } from "./script-history-modal";

export type UseScriptHistory = {
  historyOpen: boolean;
  historyRows: ScriptHistoryRow[];
  savedSource: string | null;
  currentSnapshot: string;
  markSaved: (source: string) => void;
  openHistory: () => Promise<void>;
  closeHistory: () => void;
  loadHistoryVersion: (id: string) => Promise<string>;
  restoreVersion: (id: string) => Promise<void>;
};

/**
 * Owns the "Save + Build + Check automatically…"-adjacent bookkeeping for
 * restoring a previous saved version: which source was last written to disk
 * (so a restore can warn before discarding unsaved edits) and the modal's
 * own open/rows state. Split out of app.tsx purely to stay under the
 * 500-line file cap.
 */
export function useScriptHistory(
  viewRef: { current: EditorView | null },
  setStatus: (msg: string, isError?: boolean) => void,
  checkScriptQuiet: () => Promise<void>,
): UseScriptHistory {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<ScriptHistoryRow[]>([]);
  const [savedSource, setSavedSource] = useState<string | null>(null);
  const [currentSnapshot, setCurrentSnapshot] = useState("");

  const openHistory = useCallback(async () => {
    const view = viewRef.current;
    setCurrentSnapshot(view ? view.state.doc.toString() : "");
    const data = await api<{ rows: ScriptHistoryRow[] }>("/api/script/history");
    setHistoryRows(data.rows);
    setHistoryOpen(true);
  }, [viewRef]);

  const loadHistoryVersion = useCallback(async (id: string) => {
    const data = await api<{ source: string }>(`/api/script/history/${id}`);
    return data.source;
  }, []);

  const restoreVersion = useCallback(
    async (id: string) => {
      const view = viewRef.current;
      await api("/api/script/restore", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      const data = await api<{ source: string }>("/api/script");
      if (view) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: data.source },
        });
        setDirtyBaseline(view, data.source);
      }
      setSavedSource(data.source);
      setStatus(`restored ${id}`);
      await checkScriptQuiet().catch(() => {});
    },
    [viewRef, setStatus, checkScriptQuiet],
  );

  return {
    historyOpen,
    historyRows,
    savedSource,
    currentSnapshot,
    markSaved: setSavedSource,
    openHistory,
    closeHistory: () => setHistoryOpen(false),
    loadHistoryVersion,
    restoreVersion,
  };
}
