import type { useDevices } from "./use-devices";
import type { CaptureMeta } from "../probe/use-probe-state";
import { DeviceSelect } from "./device-select";
import { SlotSelect } from "./slot-select";

export type DevicePickerProps = {
  devicesState: ReturnType<typeof useDevices>;
  withBusy: (fn: () => Promise<void>) => Promise<void>;
  setStatus: (msg: string, isError?: boolean) => void;
  /** Called with the slot and the label of the device it came from. */
  onImportSlot?: (slot: number, deviceId: string, deviceLabel: string) => void | Promise<void>;
  /** Active device's probe captures, threaded down to the device manager modal. */
  captures?: CaptureMeta[];
  onDeleteCapture?: (verKey: string) => Promise<void>;
};

/** Header device + slot pickers — split out of app.tsx to stay under the 500-line cap. */
export function DevicePicker(props: DevicePickerProps) {
  const { devicesState, withBusy, setStatus } = props;
  const activeDeviceId = devicesState.active?.device ?? null;
  const activeDeviceLabel =
    devicesState.devices.find((d) => d.id === activeDeviceId)?.label ?? activeDeviceId ?? "device";
  return (
    <>
      <DeviceSelect
        devices={devicesState.devices}
        activeDeviceId={devicesState.active?.device ?? null}
        onSwitch={(id) =>
          withBusy(async () => {
            setStatus("switching device…");
            await devicesState.switchTo(id);
            setStatus("switched device");
          })
        }
        onAdd={devicesState.addDevice}
        captures={props.captures}
        onDeleteCapture={props.onDeleteCapture}
      />
      <SlotSelect
        deviceId={devicesState.active?.device ?? null}
        activeSlot={devicesState.active?.slot ?? null}
        refreshKey={devicesState.sessionKey}
        onStatus={setStatus}
        onImport={
          props.onImportSlot && activeDeviceId
            ? (slot) =>
                withBusy(async () => {
                  await props.onImportSlot!(slot, activeDeviceId, activeDeviceLabel);
                })
            : undefined
        }
        onSwitch={(slot) =>
          withBusy(async () => {
            setStatus("switching slot…");
            await devicesState.switchSlot(slot);
            setStatus("switched slot");
          })
        }
      />
    </>
  );
}
