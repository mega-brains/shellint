import { useEffect, useRef, useState } from "preact/hooks";
import { createHistory } from "../charts/metric-history";
import { MiniBars } from "../charts/mini-bars";
import type { SparkPoint } from "../charts/spark";
import { WARN_SHARE } from "../device/device-format";

const PREFIX = "shelly-devroom.metric.";

function stored(name: string): boolean {
  try {
    return localStorage.getItem(PREFIX + name) === "history";
  } catch {
    return false;
  }
}

function remember(name: string, history: boolean): void {
  try {
    localStorage.setItem(PREFIX + name, history ? "history" : "now");
  } catch {
    /* the toggle still works for this session */
  }
}

function Gauge(props: {
  id: string;
  share: number | null;
  label: string;
  hidden?: boolean;
}) {
  const idle = props.share == null;
  const warn = !idle && (props.share as number) >= WARN_SHARE;
  const pct = idle ? 0 : Math.round((props.share as number) * 100);
  return (
    <div
      id={props.id}
      class={`gauge${idle ? " idle" : ""}${warn ? " warn" : ""}`}
      hidden={props.hidden}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={idle ? undefined : pct}
      aria-label={idle ? `${props.label} unavailable` : `${props.label} ${pct}%`}
    >
      <div
        class="gauge-fill"
        style={{ width: idle ? "0%" : `${((props.share as number) * 100).toFixed(1)}%` }}
      />
    </div>
  );
}

/**
 * Telemetry cell that can swap the live gauge for a 5-minute history of the
 * same percentage share.
 */
export function MetricSwapCell(props: {
  name: string;
  label: string;
  dtLabel: string;
  swapId: string;
  ddId: string;
  gaugeId: string;
  histId: string;
  valueText: string;
  share: number | null;
  /** Bumps on every device poll so equal shares still record a sample. */
  tick: number;
}) {
  const history = useRef(createHistory(props.name));
  const [showHistory, setShowHistory] = useState(() => stored(props.name));
  const [points, setPoints] = useState<SparkPoint[]>(() =>
    history.current.read(),
  );

  useEffect(() => {
    if (props.share != null) {
      setPoints(history.current.push(Math.round(props.share * 100)));
    } else if (props.tick > 0) {
      // Failed poll or unavailable sensor — keep the time slot so disconnects show.
      setPoints(history.current.push(null));
    } else {
      setPoints(history.current.read());
    }
  }, [props.share, props.tick]);

  const toggle = (e: Event) => {
    e.stopPropagation();
    const next = !showHistory;
    setShowHistory(next);
    remember(props.name, next);
  };

  return (
    <div>
      <dt>
        {props.dtLabel}{" "}
        <button
          type="button"
          class="metric-swap"
          id={props.swapId}
          aria-pressed={showHistory ? "true" : "false"}
          title={
            showHistory
              ? `${props.label}: showing the last 5 minutes — click for the current value`
              : `${props.label}: showing the current value — click for the last 5 minutes`
          }
          onClick={toggle}
        >
          🔄
        </button>
      </dt>
      <dd id={props.ddId}>{props.valueText}</dd>
      <Gauge
        id={props.gaugeId}
        share={props.share}
        label={props.label}
        hidden={showHistory}
      />
      <MiniBars
        id={props.histId}
        points={points}
        hidden={!showHistory}
        options={{ unit: "%", domainMin: 0, domainMax: 100 }}
      />
    </div>
  );
}
