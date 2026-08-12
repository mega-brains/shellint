import { useEffect, useRef, useState } from "preact/hooks";

export type DeviceManagerModalProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (input: { ip: string; label?: string; password?: string }) => Promise<void>;
};

/**
 * Add-device form. There is no "test before saving" round trip — `Save`
 * itself probes `Shelly.GetDeviceInfo` (server/devices.ts:addDevice) and the
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
          Stored in plaintext under <code>.devroom/</code> — this is a
          LAN-only tool with no login of its own.
        </p>
        {error ? <p class="device-manager-error">{error}</p> : null}
      </div>
      <div class="device-manager-actions">
        <button type="button" disabled={busy || !ip.trim()} onClick={() => void save()}>
          {busy ? "adding…" : "add device"}
        </button>
      </div>
    </dialog>
  );
}
