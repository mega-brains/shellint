import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api";
import type { EcoChoice, ProbeRunOptions } from "./probe-logic";

export type ProbeRunner = (opts?: ProbeRunOptions) => Promise<void>;

/**
 * Confirmation step in front of every "Run probe" button. Eco mode trades
 * execution speed for power (Sys docs: "reduced execution speed and increased
 * network latency"), and a probe is 100+ sequential `Script.Eval` round trips —
 * the one workload where that trade hurts most. The device is asked for its
 * current eco state first, so the dialog only interrupts when it would change
 * something; anything else (eco off, device unreachable, no device) runs
 * straight through and lets the probe itself report any failure.
 */
export function useProbeEcoGate(
  withBusy: (fn: () => Promise<void>) => Promise<void>,
) {
  const [pending, setPending] = useState<{ run: ProbeRunner } | null>(null);

  const requestProbe = useCallback(
    async (run: ProbeRunner) => {
      let eco: boolean | null = null;
      try {
        eco = (await api<{ eco_mode: boolean | null }>("/api/device/eco")).eco_mode;
      } catch {
        /* offline or no device — not a reason to block the probe */
      }
      if (eco === true) setPending({ run });
      else await withBusy(() => run());
    },
    [withBusy],
  );

  const confirm = useCallback(
    (ecoOff: EcoChoice | undefined) => {
      const run = pending?.run;
      setPending(null);
      if (run) void withBusy(() => run(ecoOff ? { ecoOff } : undefined));
    },
    [pending, withBusy],
  );

  const ecoModal = (
    <ProbeEcoModal open={!!pending} onCancel={() => setPending(null)} onConfirm={confirm} />
  );

  return { requestProbe, ecoModal };
}

export function ProbeEcoModal(props: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (ecoOff: EcoChoice | undefined) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // One choice, two checkboxes: "for this run" and "for good" are alternatives,
  // and neither ticked means "probe anyway, leave eco alone".
  const [choice, setChoice] = useState<EcoChoice | null>(null);

  useEffect(() => {
    if (props.open) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
      setChoice(null);
    }
  }, [props.open]);

  if (!props.open) return null;

  const pick = (value: EcoChoice) => setChoice((c) => (c === value ? null : value));

  return (
    <dialog
      ref={dialogRef}
      class="device-manager-modal probe-eco-modal"
      onClick={(e) => {
        if (e.target === dialogRef.current) props.onCancel();
      }}
      onClose={props.onCancel}
    >
      <div class="device-manager-head">
        <p>Eco mode is on</p>
        <button type="button" onClick={props.onCancel}>
          close
        </button>
      </div>
      <div class="device-manager-body">
        <p class="probe-eco-text">
          Eco mode lowers the CPU clock to save power, at the cost of{" "}
          <em>reduced execution speed and increased network latency</em>. The probe runs
          over a hundred <code>Script.Eval</code> round trips one after another, so it
          will take <strong>significantly longer</strong> with eco mode on. Turning it
          off for the run is recommended.
        </p>
        <label class="probe-eco-option">
          <input
            type="checkbox"
            checked={choice === "probe-only"}
            onChange={() => pick("probe-only")}
          />
          <span>
            Turn eco mode off for this probe only
            <small>Switched back on as soon as the run finishes.</small>
          </span>
        </label>
        <label class="probe-eco-option">
          <input
            type="checkbox"
            checked={choice === "permanent"}
            onChange={() => pick("permanent")}
          />
          <span>
            Turn eco mode off from now on
            <small>Leaves it off afterwards — same as the device panel's eco toggle.</small>
          </span>
        </label>
        <p class="device-manager-hint">
          Either option writes <code>Sys.SetConfig</code> to the device. Some firmwares
          only apply the change after a restart; the probe reports it when that happens.
        </p>
      </div>
      <div class="device-manager-actions">
        <button type="button" onClick={props.onCancel}>
          cancel
        </button>
        <button type="button" onClick={() => props.onConfirm(choice ?? undefined)}>
          {choice ? "turn eco off · run probe" : "run probe with eco on"}
        </button>
      </div>
    </dialog>
  );
}
