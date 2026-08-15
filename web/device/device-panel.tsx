import { MetricTile } from "./metric-tile";
import type { DeviceStatusState } from "./use-device-status";
import type { DeviceIdentity, DeviceStatus } from "./device-format";

export type { DeviceIdentity, DeviceStatus };

export type DevicePanelProps = { state: DeviceStatusState };

/**
 * The dock's device tab: eight telemetry tiles on one grid. Polling, the eco
 * toggle and reboot live in `use-device-status.ts` so the dock header can show
 * them while this body is unmounted (collapsed dock, or the logs tab).
 */
export function DevicePanel(props: DevicePanelProps) {
  const { metrics, err } = props.state;
  return (
    <div class="dock-body" id="devicePanel">
      <div class="tiles" id="deviceGrid" aria-label="Device telemetry">
        {metrics.map((m) => (
          <MetricTile key={m.name} metric={m} />
        ))}
      </div>
      <p class="dock-err" id="deviceErr" hidden={!err}>
        {err ?? ""}
      </p>
    </div>
  );
}
