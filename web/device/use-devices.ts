import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../lib/api";

export type DeviceInfo = { model?: string; gen?: number; ver?: string; app?: string };
export type UnsupportedDevice = { gen: number | null; model: string | null; at: string };
export type SlotBinding = { script: string; name?: string };
export type ProbeBadge = {
  required: boolean;
  reason: "never-probed" | "firmware-changed" | "none";
  ver: string | null;
  at: string | null;
};
export type Device = {
  id: string;
  label: string;
  ip: string;
  hasPassword: boolean;
  info?: DeviceInfo;
  lastSeen?: string;
  unsupported?: UnsupportedDevice;
  slots: Record<string, SlotBinding>;
  probe: ProbeBadge;
};
export type ActiveSelection = { device: string; slot: number; script: string } | null;

export type TestResult =
  | { online: true; info: Record<string, unknown>; latencyMs: number }
  | { online: false; error: string };

/**
 * Devices + active selection, plus a `sessionKey` counter bumped on every
 * switch — components that own live device state (device panel, logs panel)
 * key off it so a switch resets them instead of blending two devices.
 */
/**
 * `enabled: false` (the static/offline build — M17) keeps the mount-time
 * fetch from firing at all. The rest of the device UI already short-circuits
 * on an empty device list, so leaving the list empty is enough to keep every
 * downstream probe/slot hook quiet too.
 */
export function useDevices(enabled = true) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [active, setActive] = useState<ActiveSelection>(null);
  const [sessionKey, setSessionKey] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const data = await api<{ devices: Device[]; active: ActiveSelection }>("/api/devices");
    setDevices(data.devices);
    setActive(data.active);
  }, [enabled]);

  useEffect(() => {
    void refresh().catch(() => {
      /* header shows "no devices" via the empty list */
    });
  }, [refresh]);

  const switchTo = useCallback(
    async (deviceId: string, slot?: number) => {
      const data = await api<{ active: ActiveSelection }>("/api/session/active", {
        method: "POST",
        body: JSON.stringify({ device: deviceId, ...(slot != null ? { slot } : {}) }),
      });
      setActive(data.active);
      setSessionKey((k) => k + 1);
      await refresh();
    },
    [refresh],
  );

  const switchSlot = useCallback(
    async (slot: number) => {
      const data = await api<{ active: ActiveSelection }>("/api/session/active", {
        method: "POST",
        body: JSON.stringify({ slot }),
      });
      setActive(data.active);
      setSessionKey((k) => k + 1);
    },
    [],
  );

  const addDevice = useCallback(
    async (input: { ip: string; label?: string; password?: string }) => {
      const data = await api<{ device: Device }>("/api/devices", {
        method: "POST",
        body: JSON.stringify(input),
      });
      await refresh();
      return data.device;
    },
    [refresh],
  );

  const removeDevice = useCallback(
    async (id: string) => {
      await api("/api/devices/" + encodeURIComponent(id), { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  const testDevice = useCallback(async (id: string): Promise<TestResult> => {
    return api<TestResult>(`/api/devices/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
  }, []);

  return {
    devices,
    active,
    sessionKey,
    refresh,
    switchTo,
    switchSlot,
    addDevice,
    removeDevice,
    testDevice,
  };
}
