import { useCallback, useEffect } from "preact/hooks";
import { useProbeState } from "./use-probe-state";
import type { ProbeRunOptions } from "./probe-logic";
import type { DeployGate } from "./deploy-gate";

/**
 * Wires `useProbeState` to the deploy gate and to the banner's two actions —
 * split out of app.tsx to stay under the 500-line cap. `probeDevice` is the
 * existing `useProbe` hook's runner; this just refreshes the probe state
 * afterwards so the banner and the device picker's `!` chip clear together.
 */
export function useProbeBanner(
  deviceId: string | null,
  sessionKey: number,
  probeDevice: (opts?: ProbeRunOptions) => Promise<void>,
  deployGate: DeployGate,
  syncDeployReady: () => void,
  setStatus: (msg: string, isError?: boolean) => void,
) {
  const { probeState, refreshProbeState, skipProbe, deleteCapture } = useProbeState(
    deviceId,
    sessionKey,
  );

  useEffect(() => {
    deployGate.setProbeOk(!probeState.required);
    syncDeployReady();
  }, [deployGate, probeState, syncDeployReady]);

  const runProbeFromBanner = useCallback(
    async (opts?: ProbeRunOptions) => {
      await probeDevice(opts);
      await refreshProbeState();
    },
    [probeDevice, refreshProbeState],
  );

  const skipProbeFromBanner = useCallback(async () => {
    await skipProbe();
    setStatus(`probe skipped for ${probeState.ver ?? "unknown firmware"}`);
  }, [skipProbe, setStatus, probeState.ver]);

  return { probeState, deleteCapture, runProbeFromBanner, skipProbeFromBanner };
}
