import { useEffect, useRef, useState } from "preact/hooks";
import { DiffModal, type DiffOption } from "./diff-modal";
import { fmtBytes } from "./device-format";

export type ScriptHistoryRow = { id: string; bytes: number; ts: string };

const CURRENT_ID = "__current__";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export type ScriptHistoryModalProps = {
  open: boolean;
  rows: ScriptHistoryRow[];
  busy: boolean;
  /** Current editor buffer, used as the diff's right side. */
  currentSource: string;
  /** Last loaded/saved source, so a restore can warn on unsaved edits. */
  savedSource: string | null;
  loadVersion: (id: string) => Promise<string>;
  onRestore: (id: string) => Promise<void>;
  onClose: () => void;
};

export function ScriptHistoryModal(props: ScriptHistoryModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (props.open) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
      setPendingId(null);
    }
  }, [props.open]);

  // Unmounted (not just visually hidden) while closed, so the nested
  // DiffModal doesn't leave a second set of diff-testid nodes in the DOM
  // alongside the artifact-preview DiffModal in editor-host.tsx.
  if (!props.open) return null;

  const load = async (id: string) =>
    id === CURRENT_ID ? props.currentSource : props.loadVersion(id);

  const diffOptions: DiffOption[] = [
    { id: CURRENT_ID, label: "current editor buffer" },
    ...props.rows.map((r) => ({
      id: r.id,
      label: `${relativeTime(r.ts)} · ${fmtBytes(r.bytes)}`,
    })),
  ];

  const confirmRestore = async () => {
    if (!pendingId) return;
    const dirty = props.currentSource !== props.savedSource;
    if (dirty && !window.confirm("Unsaved editor changes will be lost. Restore anyway?")) {
      return;
    }
    setRestoring(true);
    try {
      await props.onRestore(pendingId);
      setPendingId(null);
      props.onClose();
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <dialog
        ref={dialogRef}
        class="script-history-modal"
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target === dialogRef.current) props.onClose();
        }}
        onClose={props.onClose}
      >
        <div class="script-history-head">
          <p>Script version history</p>
          <button type="button" onClick={props.onClose}>
            close
          </button>
        </div>
        {props.rows.length === 0 ? (
          <p class="script-history-empty">
            No saved versions yet — history starts recording on the next
            change.
          </p>
        ) : (
          <ol class="script-history-list">
            {props.rows.map((r) => (
              <li key={r.id} class="script-history-row">
                <span class="script-history-when">{relativeTime(r.ts)}</span>
                <span class="script-history-bytes">{fmtBytes(r.bytes)}</span>
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => setPendingId(r.id)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ol>
        )}
      </dialog>
      <DiffModal
        open={pendingId !== null}
        options={diffOptions}
        left={pendingId ?? CURRENT_ID}
        right={CURRENT_ID}
        load={load}
        onClose={() => setPendingId(null)}
        actions={
          <button
            type="button"
            class="script-history-confirm"
            disabled={restoring}
            onClick={() => void confirmRestore()}
          >
            {restoring ? "restoring…" : "restore this version"}
          </button>
        }
      />
    </>
  );
}
