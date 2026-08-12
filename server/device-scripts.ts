import type { DeviceRecord } from "./devices.ts";

/** Minimal RPC surface slot operations need — lets tests supply a fake device. */
export type SlotRpc = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
};

export type SlotInfo = {
  id: number;
  name: string | null;
  running: boolean | null;
  enable: boolean | null;
  mem_used?: number;
  /** Local script key this slot is bound to, from `devices.json.slots[n]`. */
  boundScript?: string;
};

type RawSlot = { id: number; name: string | null; enable: boolean | null };

function toRawSlot(v: unknown): RawSlot | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "number") return null;
  return {
    id: o.id,
    name: typeof o.name === "string" ? o.name : null,
    enable: typeof o.enable === "boolean" ? o.enable : null,
  };
}

/** `Script.List` — every slot on the device, whether or not it's running. */
export async function rawList(rpc: SlotRpc): Promise<RawSlot[]> {
  const res = (await rpc.call("Script.List", {})) as { scripts?: unknown } | null;
  const arr = Array.isArray(res?.scripts) ? res.scripts : [];
  return arr.map(toRawSlot).filter((s): s is RawSlot => s !== null);
}

/**
 * `Script.List` plus a `Script.GetStatus` per slot for `running`/`mem_used` —
 * best-effort: a slot whose status call fails is still listed, just without
 * those two fields.
 */
export async function listSlots(rpc: SlotRpc, device?: DeviceRecord): Promise<SlotInfo[]> {
  const slots = await rawList(rpc);
  const out: SlotInfo[] = [];
  for (const s of slots) {
    let running: boolean | null = null;
    let mem_used: number | undefined;
    try {
      const st = (await rpc.call("Script.GetStatus", { id: s.id })) as Record<
        string,
        unknown
      > | null;
      if (typeof st?.running === "boolean") running = st.running;
      if (typeof st?.mem_used === "number") mem_used = st.mem_used;
    } catch {
      /* best-effort — still list the slot */
    }
    out.push({
      id: s.id,
      name: s.name,
      running,
      enable: s.enable,
      mem_used,
      boundScript: device?.slots[String(s.id)]?.script,
    });
  }
  return out;
}

/** `Script.GetCode`, paged via `{offset, len}` until the device reports `left === 0`. */
export async function getSlotCode(rpc: SlotRpc, slot: number): Promise<string> {
  let code = "";
  let offset = 0;
  const PAGE_GUARD = 10_000; // generous — real scripts page in ~1-2KB chunks
  for (let page = 0; page < PAGE_GUARD; page += 1) {
    const res = (await rpc.call("Script.GetCode", { id: slot, offset })) as {
      data?: unknown;
      left?: unknown;
    } | null;
    const data = typeof res?.data === "string" ? res.data : "";
    code += data;
    offset += data.length;
    const left = typeof res?.left === "number" ? res.left : 0;
    if (left <= 0 || data.length === 0) break;
  }
  return code;
}

/** `Script.Create` — returns the new slot id. */
export async function createSlot(rpc: SlotRpc, name: string): Promise<number> {
  const res = (await rpc.call("Script.Create", { name })) as { id?: unknown } | null;
  const id = typeof res?.id === "number" ? res.id : null;
  if (id == null) throw new Error("Script.Create returned no id");
  return id;
}

/** `Script.Stop` (best-effort — already-stopped is fine) then `Script.Delete`. */
export async function deleteSlot(rpc: SlotRpc, slot: number): Promise<void> {
  try {
    await rpc.call("Script.Stop", { id: slot });
  } catch {
    /* not running is fine — Delete is what matters */
  }
  await rpc.call("Script.Delete", { id: slot });
}
