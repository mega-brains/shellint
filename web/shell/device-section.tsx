import type { ComponentChildren, RefObject } from "preact";
import { useCallback, useRef, useState } from "preact/hooks";
import type { EditorView } from "@codemirror/view";
import { api } from "../lib/api";
import { DevicePanel } from "../device/device-panel";
import { LogsPanel } from "../device/logs-panel";
import { Dock } from "../device/dock";
import { useDeviceStatus } from "../device/use-device-status";
import type { DeviceIdentity } from "../device/device-format";
import { DevicePicker } from "../device/device-picker";
import { useDevices } from "../device/use-devices";
import { ImportBanner, useSlotImport } from "../device/use-slot-import";
import type { DeployGate } from "../device/deploy-gate";
import { useProbe, type ProbeCapture } from "../probe/use-probe";
import { useProbeBanner } from "../probe/use-probe-banner";
import { ProbeBanner } from "../probe/probe-banner";
import { useProbeEcoGate } from "../probe/probe-eco-modal";
import { ProbeCaptureModal } from "../probe/probe-capture-modal";
import type { ProbeResult } from "../probe/probe-logic";
import type { Mode, Minify } from "./toolbar";

export type DeviceSectionProps = {
  /** From `GET /api/config`'s `static` flag — while unknown (pre-fetch) this
   * stays `false`, same as every other config-dependent default in app.tsx,
   * so the very first paint looks identical to today's server-mode UI. */
  isStatic: boolean;
  viewRef: RefObject<EditorView | null>;
  setStatus: (msg: string, isError?: boolean) => void;
  withBusy: (fn: () => Promise<void>) => Promise<void>;
  deployGate: DeployGate;
  syncDeployReady: () => void;
  /** `/api/config`'s `deviceIp` — the pre-device-load (and no-devices) fallback for the header link. */
  deviceIp: string;
};

export type DeviceSectionResult = {
  selector: ComponentChildren;
  identity: DeviceIdentity | null;
  deviceMeta: string;
  deviceOnline: boolean;
  memPeak: number | null;
  shownIp: string;
  onToggleRun?: (running: boolean) => void;
  deployTarget?: string;
  deploy: (choice: { mode: Mode; minify: Minify }) => Promise<void>;
  onProbe: () => void;
  probeResults: ProbeResult[] | null;
  probeNoteText: string;
  probeProgress: { done: number; total: number } | null;
  probeCapture: ProbeCapture | null;
  onShowCapture: () => void;
  /** Readiness-rail inputs (web/shell/readiness.ts). */
  hasDevice: boolean;
  probeRequired: boolean;
  probeSkipped: boolean;
  editorBanner: ComponentChildren;
  clearImportedBuffer: () => void;
  /** The bottom dock (device telemetry + debug logs); null in the static build. */
  dock: ComponentChildren;
  modals: ComponentChildren;
};

/**
 * Everything in app.tsx that only makes sense with a real Shelly device on
 * the LAN — split out (M17.5) so `static: true` (the static/offline build,
 * M17 plan §1) can gate it in one place instead of app.tsx growing a branch
 * per device widget. app.tsx was already at 498/500 lines, the repo's hard
 * per-file cap, with no room to absorb this inline (see use-initial-load.ts
 * for the same precedent).
 *
 * This is a hook, not a component: `useDevices`/`useProbe`/`useProbeBanner`/
 * `useProbeEcoGate`/`useSlotImport` all mount-fetch at most once (no
 * `setInterval`) and fail silently through the static router's rejections
 * (web/static/local-api.ts), so calling them unconditionally costs nothing
 * offline. The two genuinely polling paths — `useDeviceStatus` (gated by its
 * own `enabled` flag) and `LogsPanel` (`setInterval` from mount) — are why
 * `dock`/`selector`/`editorBanner`/`modals` below are `null` in static mode
 * instead of merely CSS-hidden: a `null` in returned JSX means Preact never
 * constructs those components, so their timers never start.
 */
export function useDeviceSection(props: DeviceSectionProps): DeviceSectionResult {
  const { isStatic, viewRef, setStatus, withBusy, deployGate, syncDeployReady, deviceIp } = props;

  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [deviceMeta, setDeviceMeta] = useState("—");
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [memPeak, setMemPeak] = useState<number | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const deviceRef = useRef<{ refresh: () => Promise<void> } | null>(null);

  const deviceStatus = useDeviceStatus({
    enabled: !isStatic,
    api,
    onStatus: setStatus,
    onIdentity: (id) => {
      setIdentity(id);
      setDeviceOnline(id.state !== "offline");
      setMemPeak(id.memPeak);
    },
    onMeta: setDeviceMeta,
    onReady: (ctl) => {
      deviceRef.current = ctl;
    },
  });

  const devicesState = useDevices(!isStatic);
  const activeDeviceId = devicesState.active?.device ?? null;
  const activeDevice = devicesState.devices.find((d) => d.id === activeDeviceId);
  const slotImport = useSlotImport(viewRef, setStatus);

  const { probeResults, probeNoteText, probeProgress, probeCapture, probeDevice } = useProbe(
    setStatus,
    activeDeviceId,
    devicesState.sessionKey,
  );
  const { probeState, deleteCapture, runProbeFromBanner, skipProbeFromBanner } = useProbeBanner(
    activeDeviceId,
    devicesState.sessionKey,
    probeDevice,
    deployGate,
    syncDeployReady,
    setStatus,
  );
  const { requestProbe, ecoModal } = useProbeEcoGate(withBusy);

  const deploy = useCallback(
    async (choice: { mode: Mode; minify: Minify }) => {
      const { mode, minify } = choice;
      const label = minify === "raw" ? "non-minified" : "minified";
      setStatus(`deploy ${mode}/${label}: connecting…`);
      const data = await api<{
        localBytes: number;
        deviceLen: number | null;
        status: string;
        scriptId: number;
      }>("/api/deploy", {
        method: "POST",
        body: JSON.stringify({ mode, minify }),
      });
      const len =
        data.deviceLen != null
          ? `device len ${data.deviceLen} (local ${data.localBytes})`
          : `local ${data.localBytes} B`;
      setStatus(
        `deploy ${mode}/${label}: ${data.status} · scriptId ${data.scriptId} · ${len}`,
      );
      void deviceRef.current?.refresh();
    },
    [setStatus],
  );

  const toggleRun = useCallback(
    (running: boolean) =>
      withBusy(async () => {
        setStatus(running ? "starting script…" : "stopping script…");
        const data = await api<{ running: boolean | null; scriptId: number }>(
          "/api/device/script",
          { method: "POST", body: JSON.stringify({ running }) },
        );
        const state =
          data.running === null ? "unknown" : data.running ? "running" : "stopped";
        setStatus(`script ${data.scriptId} ${state}`, data.running !== running);
        void deviceRef.current?.refresh();
      }),
    [withBusy, setStatus],
  );

  return {
    selector: isStatic ? null : (
      <DevicePicker
        devicesState={devicesState}
        withBusy={withBusy}
        setStatus={setStatus}
        onImportSlot={slotImport.importSlot}
        captures={probeState.captures}
        onDeleteCapture={deleteCapture}
      />
    ),
    identity,
    deviceMeta,
    deviceOnline,
    memPeak,
    shownIp: activeDevice?.ip ?? deviceIp,
    onToggleRun: isStatic ? undefined : (running) => void toggleRun(running),
    deployTarget: activeDevice
      ? `${activeDevice.label}:${devicesState.active?.slot ?? "?"}`
      : undefined,
    deploy,
    onProbe: () => void requestProbe(probeDevice),
    probeResults,
    probeNoteText,
    probeProgress,
    probeCapture,
    onShowCapture: () => setCaptureOpen(true),
    hasDevice: !!activeDevice,
    probeRequired: probeState.required,
    probeSkipped: !!probeState.skipped,
    editorBanner: isStatic ? null : (
      <>
        <ImportBanner imported={slotImport.imported} onDiscard={slotImport.discardImport} />
        {activeDevice ? (
          <ProbeBanner
            state={probeState}
            deviceLabel={activeDevice.label}
            onRunProbe={() => void requestProbe(runProbeFromBanner)}
            onSkip={() => void withBusy(skipProbeFromBanner)}
          />
        ) : null}
      </>
    ),
    clearImportedBuffer: slotImport.clearImport,
    dock: isStatic ? null : (
      <Dock
        key={devicesState.sessionKey}
        state={deviceStatus}
        onResize={() => viewRef.current?.requestMeasure()}
        device={<DevicePanel state={deviceStatus} />}
        logs={<LogsPanel key={devicesState.sessionKey} api={api} onStatus={setStatus} />}
      />
    ),
    modals: isStatic ? null : (
      <>
        {ecoModal}
        <ProbeCaptureModal
          open={captureOpen}
          capture={probeCapture}
          deviceId={activeDeviceId}
          onClose={() => setCaptureOpen(false)}
        />
      </>
    ),
  };
}
