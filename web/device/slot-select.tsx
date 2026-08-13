import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../lib/api";

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
  onStatus?: (msg: string, isError?: boolean) => void;
  /** Loads a slot's device code into the editor as an unsaved buffer. */
  onImport?: (slot: number) => void | Promise<void>;
};

const NEW_OPTION = "__new__";
const DELETE_OPTION = "__delete__";
const IMPORT_OPTION = "__import__";

/** Header script-slot picker for the active device, plus create/delete. */
export function SlotSelect(props: SlotSelectProps) {
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const deviceId = props.deviceId;

  const load = useCallback(async () => {
    if (!deviceId) {
      setSlots([]);
      return;
    }
    try {
      const data = await api<{ slots: SlotInfo[] }>(
        `/api/device/scripts?device=${encodeURIComponent(deviceId)}`,
      );
      setSlots(data.slots);
    } catch {
      setSlots([]);
    }
  }, [deviceId]);

  useEffect(() => {
    void load();
  }, [load, props.refreshKey, reloadTick]);

  if (!deviceId) return null;

  const createSlot = async () => {
    const name = window.prompt("Name for the new slot on this device:");
    if (!name || !name.trim()) return;
    try {
      const data = await api<{ slot: number }>("/api/device/scripts", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), device: deviceId }),
      });
      props.onStatus?.(`created slot ${data.slot} ("${name.trim()}")`);
      setReloadTick((t) => t + 1);
      await props.onSwitch(data.slot);
    } catch (e) {
      props.onStatus?.(e instanceof Error ? e.message : String(e), true);
    }
  };

  const deleteSlot = async () => {
    if (props.activeSlot == null) return;
    const current = slots.find((s) => s.id === props.activeSlot);
    const label = current?.name ?? String(props.activeSlot);
    const typed = window.prompt(
      `This deletes slot ${props.activeSlot} ("${label}") on the device — type its name to confirm:`,
    );
    if (typed !== label) {
      if (typed !== null) props.onStatus?.("delete cancelled — name did not match", true);
      return;
    }
    try {
      await api(`/api/device/scripts/${props.activeSlot}?device=${encodeURIComponent(deviceId)}`, {
        method: "DELETE",
      });
      props.onStatus?.(`deleted slot ${props.activeSlot}`);
      setReloadTick((t) => t + 1);
    } catch (e) {
      props.onStatus?.(e instanceof Error ? e.message : String(e), true);
    }
  };

  return (
    <select
      class="slot-select"
      id="slotSelect"
      aria-label="Active script slot"
      value={props.activeSlot ?? ""}
      onChange={(e) => {
        const value = (e.target as HTMLSelectElement).value;
        (e.target as HTMLSelectElement).value = String(props.activeSlot ?? "");
        if (value === NEW_OPTION) return void createSlot();
        if (value === DELETE_OPTION) return void deleteSlot();
        if (value === IMPORT_OPTION) {
          if (props.activeSlot != null) void props.onImport?.(props.activeSlot);
          return;
        }
        const n = Number(value);
        if (Number.isFinite(n)) void props.onSwitch(n);
      }}
    >
      {slots.length === 0 ? <option value="">no slots</option> : null}
      {slots.map((s) => (
        <option key={s.id} value={s.id}>
          {s.id} · {s.name ?? "unnamed"}
          {s.running ? " ▶" : ""}
        </option>
      ))}
      <option value={NEW_OPTION}>+ New slot…</option>
      <option value={IMPORT_OPTION} disabled={props.activeSlot == null || !props.onImport}>
        Import code from slot
      </option>
      <option value={DELETE_OPTION} disabled={props.activeSlot == null}>
        Delete slot…
      </option>
    </select>
  );
}
