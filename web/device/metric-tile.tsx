import { useState } from "preact/hooks";
import { MiniBars } from "../charts/mini-bars";
import { WARN_SHARE } from "./device-format";
import type { Metric } from "./use-device-status";

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

/** Uppercase first letter — `mem` → `dMem`, so the DOM ids stay stable. */
function cap(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * One dock telemetry tile: label · value · bar, where `↻` swaps the bar for the
 * last five minutes of the same value in place — the tile keeps its size either
 * way, so the grid never reflows when a toggle is flipped.
 */
export function MetricTile(props: { metric: Metric }) {
  const m = props.metric;
  const hasHistory = m.points.length > 0;
  const [showHistory, setShowHistory] = useState(() => stored(m.name));
  const history = hasHistory && showHistory;
  const idle = m.share == null;
  // A tone the model set wins; otherwise a bar only colours near a real limit.
  const tone =
    m.tone || (!idle && (m.share as number) >= WARN_SHARE ? "warn" : "");
  const pct = idle ? 0 : Math.round((m.share as number) * 100);

  return (
    <div class="tile" title={m.title}>
      <div class="tile-head">
        <span class="tile-label">{m.label}</span>
        {hasHistory ? (
          <button
            type="button"
            class="tile-swap"
            id={`swap${cap(m.name)}`}
            aria-pressed={showHistory ? "true" : "false"}
            title={
              showHistory
                ? `${m.label}: showing the last 5 minutes — click for the current value`
                : `${m.label}: showing the current value — click for the last 5 minutes`
            }
            onClick={() => {
              const next = !showHistory;
              setShowHistory(next);
              remember(m.name, next);
            }}
          >
            ↻
          </button>
        ) : null}
      </div>
      <div class={`tile-value${m.tone ? ` ${m.tone}` : ""}`} id={`d${cap(m.name)}`}>
        {m.value}
      </div>
      {history ? (
        <MiniBars
          id={`h${cap(m.name)}`}
          aria-label={`${m.label}, last 5 minutes`}
          points={m.points}
          options={m.options}
        />
      ) : (
        <>
          <div
            class={`track${idle ? " idle" : ""}${tone ? ` ${tone}` : ""}`}
            id={`g${cap(m.name)}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={idle ? undefined : pct}
            aria-label={idle ? `${m.label} unavailable` : `${m.label} ${pct}%`}
          >
            <div class="track-fill" style={{ width: idle ? "0%" : `${pct}%` }} />
          </div>
          <p class="tile-sub">{m.sub}</p>
        </>
      )}
    </div>
  );
}
