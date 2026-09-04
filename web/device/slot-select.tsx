import { useCallback, useEffect, useRef, useState } from "preact/hooks";
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
const RETRY_OPTION = "__retry__";

type SlotLoad =
  | { phase: "loading" }
  | { phase: "ready"; slots: SlotInfo[] }
  | { phase: "error"; message: string };

/** Header script-slot picker for the active device, plus create/delete. */
export function SlotSelect(props: SlotSelectProps) {
  const [loadState, setLoadState] = useState<SlotLoad>({ phase: "loading" });
  const [reloadTick, setReloadTick] = useState(0);
  const inFlight = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retried = useRef<string | null>(null);
  const deviceId = props.deviceId;
  const slots = loadState.phase === "ready" ? loadState.slots : [];

  const load = useCallback(async () => {
    if (inFlight.current) return;
    if (!deviceId) {
      setLoadState({ phase: "ready", slots: [] });
      return;
    }
    inFlight.current = true;
    setLoadState({ phase: "loading" });
    try {
      const data = await api<{ slots: SlotInfo[] }>(
        `/api/device/scripts?device=${encodeURIComponent(deviceId)}`,
      );
      setLoadState({ phase: "ready", slots: data.slots });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLoadState({ phase: "error", message });
      props.onStatus?.(message, true);
      const retryKey = `${deviceId}:${props.refreshKey}`;
      if (retried.current !== retryKey) {
        retried.current = retryKey;
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          void load();
        }, 3000);
      }
    } finally {
      inFlight.current = false;
    }
  }, [deviceId, props.refreshKey, props.onStatus]);

  useEffect(() => {
    void load();
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
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
      title={loadState.phase === "error" ? loadState.message : undefined}
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
        if (value === RETRY_OPTION) {
          setReloadTick((t) => t + 1);
          return;
        }
        const n = Number(value);
        if (Number.isFinite(n)) void props.onSwitch(n);
      }}
    >
      {loadState.phase === "loading" ? <option value="">loading slots…</option> : null}
      {loadState.phase === "error" ? (
        <option value={props.activeSlot ?? ""}>
          {props.activeSlot == null
            ? "⚠ slots unavailable"
            : `⚠ slot ${props.activeSlot} — device did not answer`}
        </option>
      ) : null}
      {loadState.phase === "ready" && slots.length === 0 ? (
        <option value={props.activeSlot ?? ""}>
          {props.activeSlot == null
            ? "no slots on this device"
            : `slot ${props.activeSlot} — not on this device`}
        </option>
      ) : null}
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
      {loadState.phase === "error" ? <option value={RETRY_OPTION}>↻ retry</option> : null}
    </select>
  );
}
