import { useState } from "preact/hooks";
import type { Device } from "./use-devices";
import { DeviceManagerModal } from "./device-manager-modal";

const ADD_OPTION = "__add__";

export type DeviceSelectProps = {
  devices: Device[];
  activeDeviceId: string | null;
  onSwitch: (id: string) => void | Promise<void>;
  onAdd: (input: { ip: string; label?: string; password?: string }) => Promise<Device>;
};

/** Header device picker. `+ Add device…` opens the manager modal inline. */
export function DeviceSelect(props: DeviceSelectProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <select
        class="device-select"
        id="deviceSelect"
        aria-label="Active device"
        value={props.activeDeviceId ?? ""}
        onChange={(e) => {
          const value = (e.target as HTMLSelectElement).value;
          if (value === ADD_OPTION) {
            setModalOpen(true);
            return;
          }
          if (value) void props.onSwitch(value);
        }}
      >
        {props.devices.length === 0 ? <option value="">no devices</option> : null}
        {props.devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label} ({d.ip})
          </option>
        ))}
        <option value={ADD_OPTION}>+ Add device…</option>
      </select>
      <DeviceManagerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdd={async (input) => {
          const device = await props.onAdd(input);
          setModalOpen(false);
          await props.onSwitch(device.id);
        }}
      />
    </>
  );
}
