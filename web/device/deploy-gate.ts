/**
 * Deploy stays disabled until the last Build and the last Check came back
 * with zero errors, and the active device's probe-required gate is clear —
 * keeps a broken build, or an unprobed device, from being deployed to. The
 * server enforces the probe half independently (`deploy.ts`); this is only
 * so the button can explain itself before the round trip.
 */
export function createDeployGate() {
  let buildOk = false;
  let checkOk = false;
  let probeOk = true;
  return {
    setBuildOk: (ok: boolean) => {
      buildOk = ok;
    },
    setCheckOk: (ok: boolean) => {
      checkOk = ok;
    },
    setProbeOk: (ok: boolean) => {
      probeOk = ok;
    },
    ready: () => buildOk && checkOk && probeOk,
  };
}

export type DeployGate = ReturnType<typeof createDeployGate>;
