import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api";
import type { ProbeCapture } from "./use-probe";

/**
 * The stored probe capture, shown raw. The path in the probe log is not just a
 * label — clicking it opens the very JSON that lives at that path, so "which
 * answers is the lint tier actually using" is one click away.
 */
export function ProbeCaptureModal(props: {
  open: boolean;
  capture: ProbeCapture | null;
  deviceId: string | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (props.open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    setText(null);
    setError(null);
    void (async () => {
      try {
        const q = props.deviceId
          ? `?device=${encodeURIComponent(props.deviceId)}`
          : "";
        const data = await api<{ report: unknown }>(`/api/probe/last${q}`);
        if (cancelled) return;
        setText(JSON.stringify(data.report, null, 2));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.open, props.deviceId]);

  if (!props.open) return null;

  return (
    <dialog
      ref={dialogRef}
      class="device-manager-modal probe-capture-modal"
      onClick={(e) => {
        if (e.target === dialogRef.current) props.onClose();
      }}
      onClose={props.onClose}
    >
      <div class="device-manager-head">
        <p>probe capture</p>
        <button type="button" onClick={props.onClose}>
          close
        </button>
      </div>
      <div class="device-manager-body">
        <p class="probe-log-note" id="probeCapturePath">
          {props.capture?.path ?? "—"}
        </p>
        <p class="probe-log-note">
          captured {props.capture?.at || "—"} · firmware{" "}
          {props.capture?.ver ?? "unknown"}
        </p>
        <pre class="probe-log-note probe-capture-json" id="probeCaptureJson">
          {error ? `unavailable: ${error}` : (text ?? "loading…")}
        </pre>
      </div>
    </dialog>
  );
}
