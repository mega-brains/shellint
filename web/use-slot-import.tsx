import { useCallback, useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { EditorView } from "@codemirror/view";
import { api } from "./api";

export type ImportedBuffer = {
  slot: number;
  deviceLabel: string;
  bytes: number;
  /** Editor contents at the moment of import, so Discard can restore them. */
  replaced: string;
};

/**
 * `Import code from slot` — pulls a slot's source off the device and drops it
 * into the editor as an *unsaved* buffer. It is never written to disk here:
 * the user saves (or discards) deliberately, and the existing `PUT /api/script`
 * path then snapshots the previous source into the version history.
 *
 * The dirty baseline is deliberately left alone, so every replaced line shows
 * up in the dirty gutter exactly as a hand edit would.
 */
export function useSlotImport(
  viewRef: RefObject<EditorView | null>,
  setStatus: (msg: string, isError?: boolean) => void,
) {
  const [imported, setImported] = useState<ImportedBuffer | null>(null);

  const replaceDoc = (view: EditorView, text: string) => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  };

  const importSlot = useCallback(
    async (slot: number, deviceId: string, deviceLabel: string) => {
      const view = viewRef.current;
      if (!view) return;
      try {
        const data = await api<{ slot: number; bytes: number; code: string }>(
          `/api/device/script/code?slot=${slot}&device=${encodeURIComponent(deviceId)}`,
        );
        const replaced = view.state.doc.toString();
        replaceDoc(view, data.code);
        setImported({ slot: data.slot, deviceLabel, bytes: data.bytes, replaced });
        setStatus(`imported slot ${data.slot} (${data.bytes} B) — unsaved`);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e), true);
      }
    },
    [viewRef, setStatus],
  );

  const discardImport = useCallback(() => {
    const view = viewRef.current;
    if (!view || !imported) return;
    replaceDoc(view, imported.replaced);
    setImported(null);
    setStatus("discarded imported code");
  }, [viewRef, imported, setStatus]);

  /** The banner is about *unsaved* device code, so saving clears it. */
  const clearImport = useCallback(() => setImported(null), []);

  return { imported, importSlot, discardImport, clearImport };
}

export function ImportBanner(props: {
  imported: ImportedBuffer | null;
  onDiscard: () => void;
}) {
  const i = props.imported;
  if (!i) return null;
  return (
    <div class="import-banner" role="status">
      <span class="import-banner-text">
        <strong>Imported slot {i.slot}</strong> from {i.deviceLabel} ({i.bytes} B) — unsaved.
        This is device JavaScript, not TypeScript: it will not typecheck against{" "}
        <code>types/shelly.d.ts</code> as-is.
      </span>
      <button type="button" class="import-banner-discard" onClick={props.onDiscard}>
        Discard
      </button>
    </div>
  );
}
