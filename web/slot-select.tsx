import { useEffect, useState } from "preact/hooks";
import { api } from "./api";

export type SlotInfo = {
  id: number;
  name: string | null;
  running: boolean | null;
  enable: boolean | null;
  mem_used?: number;
  boundScript?: string;
};

export type SlotSelectProps = {
  deviceId: string | null;
  activeSlot: number | null;
  onSwitch: (slot: number) => void | Promise<void>;
  /** Bumped on device switch, so the slot list refetches for the new device. */
  refreshKey: number;
};

/** Header script-slot picker for the active device. */
export function SlotSelect(props: SlotSelectProps) {
  const [slots, setSlots] = useState<SlotInfo[]>([]);

  useEffect(() => {
    if (!props.deviceId) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    void api<{ slots: SlotInfo[] }>(
      `/api/device/scripts?device=${encodeURIComponent(props.deviceId)}`,
    )
      .then((data) => {
        if (!cancelled) setSlots(data.slots);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [props.deviceId, props.refreshKey]);

  if (!props.deviceId) return null;

  return (
    <select
      class="slot-select"
      id="slotSelect"
      aria-label="Active script slot"
      value={props.activeSlot ?? ""}
      onChange={(e) => {
        const value = Number((e.target as HTMLSelectElement).value);
        if (Number.isFinite(value)) void props.onSwitch(value);
      }}
    >
      {slots.length === 0 ? <option value="">no slots</option> : null}
      {slots.map((s) => (
        <option key={s.id} value={s.id}>
          {s.id} · {s.name ?? "unnamed"}
          {s.running ? " ▶" : ""}
        </option>
      ))}
    </select>
  );
}
