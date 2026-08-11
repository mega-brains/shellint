import { createHistory } from "./metric-history";
import { renderMiniBars } from "./mini-bars";

/**
 * Telemetry cells that report a share of a total show a gauge of the current
 * sample. This swaps that cell for the last five minutes of the same value,
 * the way latency and rssi already read — one is "how full", the other "going
 * which way", and both are worth having without spending two cells on each.
 */
const PREFIX = "shelly-devroom.metric.";

export type MetricSwap = {
  /** A percentage, or null when the device did not report it this poll. */
  record(percent: number | null): void;
};

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

export function createMetricSwap(
  name: string,
  els: { gauge: HTMLElement; host: HTMLElement; button: HTMLButtonElement },
  label: string,
): MetricSwap {
  const history = createHistory(name);
  let showHistory = stored(name);

  function draw() {
    if (!showHistory) return;
    renderMiniBars(els.host, history.read(), {
      unit: "%",
      domainMin: 0,
      domainMax: 100,
    });
  }

  function apply() {
    els.gauge.hidden = showHistory;
    els.host.hidden = !showHistory;
    els.button.setAttribute("aria-pressed", showHistory ? "true" : "false");
    els.button.title = showHistory
      ? `${label}: showing the last 5 minutes — click for the current value`
      : `${label}: showing the current value — click for the last 5 minutes`;
    draw();
  }

  els.button.addEventListener("click", (e) => {
    // The cell sits inside the panel header's collapse target.
    e.stopPropagation();
    showHistory = !showHistory;
    remember(name, showHistory);
    apply();
  });

  apply();

  return {
    record(percent) {
      if (percent != null) history.push(Math.round(percent));
      draw();
    },
  };
}
