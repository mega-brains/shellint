/**
 * Deploy stays disabled until both the last Build and the last Check came
 * back with zero errors — keeps a broken build from reaching the device.
 */
export function createDeployGate() {
  let buildOk = false;
  let checkOk = false;
  return {
    setBuildOk: (ok: boolean) => {
      buildOk = ok;
    },
    setCheckOk: (ok: boolean) => {
      checkOk = ok;
    },
    ready: () => buildOk && checkOk,
  };
}

export type DeployGate = ReturnType<typeof createDeployGate>;
