import { useEffect, useRef, useState } from "preact/hooks";
import type { CaptureMeta } from "../probe/use-probe-state";

export type DeviceManagerModalProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (input: { ip: string; label?: string; password?: string }) => Promise<void>;
  /** Probe captures for the currently active device (M16 §5) — the modal
   * has no per-device browsing of its own yet, so this is the one device
   * whose captures can be managed here. */
  activeDevice?: { id: string; label: string } | null;
  captures?: CaptureMeta[];
  onDeleteCapture?: (verKey: string) => Promise<void>;
};

function dateOnly(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

/**
 * Add-device form. There is no "test before saving" round trip — `Save`
 * itself probes `Shelly.GetDeviceInfo` (server/device/devices.ts:addDevice) and the
 * device is added either way, online or not; a failed probe just means the
 * offline-fallback id (slug of the label/IP) is used instead of the
 * device's own id.
 */
export function DeviceManagerModal(props: DeviceManagerModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [ip, setIp] = useState("");
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (props.open) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
      setIp("");
      setLabel("");
      setPassword("");
      setError(null);
    }
  }, [props.open]);

  if (!props.open) return null;

  const save = async () => {
    const trimmedIp = ip.trim();
    if (!trimmedIp) {
      setError("IP address is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await props.onAdd({
        ip: trimmedIp,
        label: label.trim() || undefined,
        password: password || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      class="device-manager-modal"
      onClick={(e) => {
        if (e.target === dialogRef.current) props.onClose();
      }}
      onClose={props.onClose}
    >
      <div class="device-manager-head">
        <p>Add device</p>
        <button type="button" onClick={props.onClose}>
          close
        </button>
      </div>
      <div class="device-manager-body">
        <label class="device-manager-field">
          IP address
          <input
            value={ip}
            placeholder="192.168.1.100"
            onInput={(e) => setIp((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="device-manager-field">
          Label (optional)
          <input
            value={label}
            placeholder="Kitchen dimmer"
            onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="device-manager-field">
          Password (optional)
          <input
            type="password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
        </label>
        <p class="device-manager-hint">
          Stored in plaintext under <code>.shellint/</code> — this is a
          LAN-only tool with no login of its own.
        </p>
        {error ? <p class="device-manager-error">{error}</p> : null}
      </div>
      <div class="device-manager-actions">
        <button type="button" disabled={busy || !ip.trim()} onClick={() => void save()}>
          {busy ? "adding…" : "add device"}
        </button>
      </div>
      {props.activeDevice && props.captures ? (
        <CaptureList
          deviceLabel={props.activeDevice.label}
          captures={props.captures}
          onDelete={props.onDeleteCapture}
        />
      ) : null}
    </dialog>
  );
}

function CaptureList(props: {
  deviceLabel: string;
  captures: CaptureMeta[];
  onDelete?: (verKey: string) => Promise<void>;
}) {
  return (
    <div class="device-manager-captures">
      <p class="device-manager-captures-head">
        Probe captures for {props.deviceLabel}
      </p>
      {props.captures.length === 0 ? (
        <p class="device-manager-hint">none yet</p>
      ) : (
        <ul class="device-manager-capture-list">
          {props.captures.map((c) => (
            <li key={c.verKey} class="checks-note-row">
              <span>
                fw {c.ver ?? "unknown"} · {dateOnly(c.at)} · {c.present} present / {c.absent} absent
              </span>
              {props.onDelete ? (
                <button type="button" onClick={() => void props.onDelete!(c.verKey)}>
                  delete
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
