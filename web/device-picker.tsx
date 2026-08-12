import type { useDevices } from "./use-devices";
import { DeviceSelect } from "./device-select";
import { SlotSelect } from "./slot-select";

export type DevicePickerProps = {
  devicesState: ReturnType<typeof useDevices>;
  withBusy: (fn: () => Promise<void>) => Promise<void>;
  setStatus: (msg: string, isError?: boolean) => void;
};

/** Header device + slot pickers — split out of app.tsx to stay under the 500-line cap. */
export function DevicePicker(props: DevicePickerProps) {
  const { devicesState, withBusy, setStatus } = props;
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
      />
      <SlotSelect
        deviceId={devicesState.active?.device ?? null}
        activeSlot={devicesState.active?.slot ?? null}
        refreshKey={devicesState.sessionKey}
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
