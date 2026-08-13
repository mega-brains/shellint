import { useState } from "preact/hooks";
import type { Device } from "./use-devices";
import type { CaptureMeta } from "../probe/use-probe-state";
import { DeviceManagerModal } from "./device-manager-modal";

const ADD_OPTION = "__add__";

export type DeviceSelectProps = {
  devices: Device[];
  activeDeviceId: string | null;
  onSwitch: (id: string) => void | Promise<void>;
  onAdd: (input: { ip: string; label?: string; password?: string }) => Promise<Device>;
  /** Probe captures for the active device, so the "add device" modal can
   * double as the one place to browse/delete them (M16 §5). */
  captures?: CaptureMeta[];
  onDeleteCapture?: (verKey: string) => Promise<void>;
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
            {d.probe.required ? "! " : ""}
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
        activeDevice={
          props.activeDeviceId
            ? {
                id: props.activeDeviceId,
                label:
                  props.devices.find((d) => d.id === props.activeDeviceId)?.label ??
                  props.activeDeviceId,
              }
            : null
        }
        captures={props.captures}
        onDeleteCapture={props.onDeleteCapture}
      />
    </>
  );
}
