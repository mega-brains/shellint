import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "./api";

export type CaptureMeta = {
  ver: string | null;
  verKey: string;
  at: string;
  path: string;
  present: number;
  absent: number;
};

export type ProbeState = {
  required: boolean;
  reason: "never-probed" | "firmware-changed" | "none";
  ver: string | null;
  matched: CaptureMeta | null;
  newest: CaptureMeta | null;
  skipped: { ver: string | null; at: string } | null;
  captures: CaptureMeta[];
};

const EMPTY: ProbeState = {
  required: false,
  reason: "none",
  ver: null,
  matched: null,
  newest: null,
  skipped: null,
  captures: [],
};

/**
 * Probe-required state for the active device — refreshed on mount, on every
 * `sessionKey` change (a device/slot switch), and after a probe run or skip.
 * `GET /api/probe/state` is offline-safe (no RPC), so this never blocks on
 * device reachability the way running the probe itself does.
 */
export function useProbeState(deviceId: string | null, sessionKey: number) {
  const [state, setState] = useState<ProbeState>(EMPTY);

  const refresh = useCallback(async () => {
    if (!deviceId) {
      setState(EMPTY);
      return;
    }
    try {
      const data = await api<ProbeState>(`/api/probe/state?device=${encodeURIComponent(deviceId)}`);
      setState(data);
    } catch {
      setState(EMPTY);
    }
  }, [deviceId]);

  useEffect(() => {
    void refresh();
  }, [refresh, sessionKey]);

  const skip = useCallback(async () => {
    if (!deviceId) return;
    const data = await api<ProbeState>("/api/probe/skip", {
      method: "POST",
      body: JSON.stringify({ device: deviceId }),
    });
    setState(data);
  }, [deviceId]);

  const deleteCapture = useCallback(
    async (verKey: string) => {
      if (!deviceId) return;
      const data = await api<ProbeState>(
        `/api/probe/captures/${encodeURIComponent(verKey)}?device=${encodeURIComponent(deviceId)}`,
        { method: "DELETE" },
      );
      setState(data);
    },
    [deviceId],
  );

  return { probeState: state, refreshProbeState: refresh, skipProbe: skip, deleteCapture };
}
