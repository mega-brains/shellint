import type { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { EditorView } from "@codemirror/view";
import { api } from "../lib/api";
import { Button, ButtonDropdown, CLOSE_MENUS_EVENT } from "../ui/button";
import {
  ARTIFACT_DOWNLOAD_NAMES,
  downloadAllArtifacts,
  downloadArtifact,
  downloadText,
  openFilePicker,
  openFromBlob,
  saveToHandle,
  supportsFilePicker,
  type OpenedFile,
} from "../static/file-io";

export type StaticFileControlsProps = {
  viewRef: RefObject<EditorView | null>;
  setStatus: (msg: string, isError?: boolean) => void;
  /** Called with the opened text after the editor doc + `/api/script` are updated,
   * so app.tsx can rerun its usual "just loaded a script" bookkeeping (dirty
   * baseline, history snapshot, a quiet check). */
  onOpened: (source: string) => void;
};

/**
 * Load-from-disk / save-to-disk / artifact-download controls for the static
 * build (M17.6) — only meaningful offline, where the source lives in the
 * browser rather than on the DevRoom's own disk. Split out of toolbar.tsx
 * (already 432/500 lines) and wired in as a `staticControls` slot rather
 * than importing anything static-only from shared code: everything below
 * goes through the ordinary `api()` seam (see web/static/file-io.ts's header).
 */
export function StaticFileControls(props: StaticFileControlsProps) {
  const { viewRef, setStatus, onOpened } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<FileSystemFileHandle | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [hasHandle, setHasHandle] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const close = () => setDownloadOpen(false);
    document.addEventListener(CLOSE_MENUS_EVENT, close);
    return () => document.removeEventListener(CLOSE_MENUS_EVENT, close);
  }, []);

  const applyOpened = useCallback(
    (opened: OpenedFile) => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: opened.text },
      });
      handleRef.current = opened.handle ?? null;
      setHasHandle(opened.handle != null);
      setFileName(opened.name);
      void api("/api/script", {
        method: "PUT",
        body: JSON.stringify({ source: opened.text, kind: opened.kind }),
      }).catch((e) => setStatus(e instanceof Error ? e.message : String(e), true));
      onOpened(opened.text);
      setStatus(`opened ${opened.name} (${opened.kind})`);
    },
    [viewRef, onOpened, setStatus],
  );

  const onOpenClick = useCallback(async () => {
    if (!supportsFilePicker()) {
      inputRef.current?.click();
      return;
    }
    setBusy(true);
    try {
      const opened = await openFilePicker();
      if (opened) applyOpened(opened);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  }, [applyOpened, setStatus]);

  const onInputChange = useCallback(
    async (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      try {
        applyOpened(await openFromBlob(file));
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err), true);
      }
    },
    [applyOpened, setStatus],
  );

  // Drag-and-drop onto the editor host — queried by id rather than plumbed
  // through editor-host.tsx's props, so that shared component stays untouched
  // by a feature that only exists in static mode.
  useEffect(() => {
    const host = document.getElementById("editor");
    if (!host) return;
    const isFileDrag = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      host.classList.add("file-drop-active");
    };
    const onDragLeave = () => host.classList.remove("file-drop-active");
    const onDrop = (e: DragEvent) => {
      host.classList.remove("file-drop-active");
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      openFromBlob(file)
        .then(applyOpened)
        .catch((err) => setStatus(err instanceof Error ? err.message : String(err), true));
    };
    host.addEventListener("dragover", onDragOver);
    host.addEventListener("dragleave", onDragLeave);
    host.addEventListener("drop", onDrop);
    return () => {
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("dragleave", onDragLeave);
      host.removeEventListener("drop", onDrop);
    };
  }, [applyOpened, setStatus]);

  const onSave = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const text = view.state.doc.toString();
    const name = fileName ?? "main.ts";
    setBusy(true);
    try {
      if (handleRef.current) {
        await saveToHandle(handleRef.current, text);
        setStatus(`saved ${name} to disk`);
      } else {
        downloadText(name, text);
        setStatus(`downloaded ${name}`);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  }, [viewRef, fileName, setStatus]);

  const onDownloadAll = useCallback(async () => {
    setBusy(true);
    try {
      const n = await downloadAllArtifacts(api);
      setStatus(n ? `downloaded ${n} artifact(s)` : "no built artifacts yet — run Build first", n === 0);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  }, [setStatus]);

  const onDownloadPick = useCallback(
    (item: HTMLButtonElement) => {
      const name = item.dataset.artifact;
      if (!name) return;
      void downloadArtifact(api, name)
        .then(() => setStatus(`downloaded ${name}`))
        .catch((e) => setStatus(e instanceof Error ? e.message : String(e), true));
    },
    [setStatus],
  );

  return (
    <>
      <input
        ref={inputRef}
        id="staticOpenFile"
        type="file"
        accept=".js,.mjs,.ts"
        class="visually-hidden"
        onChange={(e) => void onInputChange(e)}
      />
      <Button
        id="btnStaticOpen"
        title="Open a .js/.ts file from disk (or drag one onto the editor)"
        disabled={busy}
        onClick={() => void onOpenClick()}
      >
        Open
      </Button>
      <Button
        id="btnStaticSave"
        title={hasHandle ? `Save back to ${fileName}` : "Download the editor contents as a file"}
        disabled={busy}
        onClick={() => void onSave()}
      >
        {hasHandle ? "Save to disk" : "Download"}
      </Button>
      <ButtonDropdown
        rootId="downloadArtifactsSplit"
        toggleId="btnDownloadArtifactsMenu"
        menuId="downloadArtifactsMenu"
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
        disabled={busy}
        toggleTitle="Download one built artifact"
        onPick={onDownloadPick}
        primary={
          <Button
            id="btnDownloadArtifacts"
            title="Download all built dist artifacts (debug/prod × raw/min/adv + the prod log map)"
            disabled={busy}
            onClick={() => void onDownloadAll()}
          >
            Artifacts
          </Button>
        }
        menu={
          <ul class="menu" id="downloadArtifactsMenu" role="menu">
            {ARTIFACT_DOWNLOAD_NAMES.map((name) => (
              <li role="none" key={name}>
                <Button role="menuitem" data-artifact={name}>
                  {name}
                </Button>
              </li>
            ))}
          </ul>
        }
      />
    </>
  );
}
