import { createCollapsible } from "./collapsible";
import { renderSparkline, type SparkPoint, type SparkSeries } from "./spark";

const STORAGE_KEY = "shelly-devroom.logsPanel.collapsed";
const POLL_MS = 2_000;
/** The server ring buffer is the real backstop; these only bound the DOM. */
const MAX_LINES = 200;
const MAX_POINTS = 240;
const MAX_SERIES = 4;

export type LogLine = { seq: number; ts: number; level: number; text: string };
export type MetricPoint = { ts: number; series: string; value: number };

export type LogStream = {
  connected: boolean;
  seq: number;
  dropped: number;
  lines: LogLine[];
  metrics: MetricPoint[];
};

export type LogsPanelEls = {
  panel: HTMLElement;
  head: HTMLElement;
  toggle: HTMLElement;
  peek: HTMLElement;
  body: HTMLElement;
  button: HTMLButtonElement;
  note: HTMLElement;
  spark: HTMLElement;
  chart: HTMLElement;
  chartHead: HTMLElement;
  chartToggle: HTMLElement;
  chartPeek: HTMLElement;
  list: HTMLElement;
  clear: HTMLButtonElement;
  filter: HTMLInputElement;
  follow: HTMLInputElement;
};

type ApiFn = <T>(
  path: string,
  init?: RequestInit,
) => Promise<T & { ok: boolean; error?: string }>;

function fmtClock(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function createLogsPanel(opts: {
  els: LogsPanelEls;
  api: ApiFn;
  onStatus: (msg: string, isError?: boolean) => void;
}) {
  const { els, api, onStatus } = opts;
  createCollapsible(els, {
    storageKey: STORAGE_KEY,
    defaultCollapsed: true,
    // The stream controls live in the head so they work while collapsed;
    // using them must not fold the panel away underneath the click.
    ignoreSelector: ".logs-controls",
  });

  createCollapsible(
    { panel: els.chart, head: els.chartHead, toggle: els.chartToggle },
    {
      storageKey: "shelly-devroom.logsChart.collapsed",
      defaultCollapsed: false,
    },
  );

  function setPeek(text: string, isError = false) {
    els.peek.textContent = text;
    els.peek.classList.toggle("error", isError);
  }

  const series = new Map<string, SparkPoint[]>();
  let lines: LogLine[] = [];
  let since = 0;
  let streaming = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Substring match, not a pattern: the device log is noisy and grep-shaped. */
  function matches(line: LogLine): boolean {
    const needle = els.filter.value.trim().toLowerCase();
    if (!needle) return true;
    return `${fmtClock(line.ts)} ${line.text}`.toLowerCase().includes(needle);
  }

  function renderLines() {
    // Re-rendering the whole list drops the scroll offset, so it is restored
    // explicitly whenever the user has chosen to stay put.
    const keepAt = els.list.scrollTop;
    els.list.replaceChildren();
    let shown = 0;
    for (const line of lines.slice(-MAX_LINES)) {
      if (!matches(line)) continue;
      shown += 1;
      const li = document.createElement("li");
      li.className = `level-${line.level}`;
      if (line.text.includes("#m ")) li.classList.add("metric");
      li.textContent = `${fmtClock(line.ts)} ${line.text}`;
      els.list.appendChild(li);
    }
    if (shown === 0 && lines.length > 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = `no line matches “${els.filter.value.trim()}”`;
      els.list.appendChild(li);
    }
    els.list.scrollTop = els.follow.checked ? els.list.scrollHeight : keepAt;
  }

  function renderChart() {
    const chart: SparkSeries[] = [...series.entries()]
      .slice(0, MAX_SERIES)
      .map(([label, points]) => ({ label, points }));
    // Collapsed, the header still says whether anything is being charted.
    els.chartPeek.textContent = chart.length
      ? chart.map((s) => s.label).join(" · ")
      : "no #m series yet";
    renderSparkline(els.spark, chart, {
      height: 64,
      formatX: (x) => fmtClock(x),
      formatY: (y) => (Number.isInteger(y) ? String(y) : y.toFixed(2)),
    });
  }

  /**
   * A dropped-line gap is real data loss on the device's circular buffer, so it
   * enters every series as a null point and the chart breaks there.
   */
  function markGap() {
    for (const points of series.values()) {
      const last = points[points.length - 1];
      if (last && last.y !== null) points.push({ x: last.x, y: null });
    }
  }

  function absorb(stream: LogStream) {
    if (stream.dropped > 0) markGap();
    for (const point of stream.metrics) {
      const points = series.get(point.series) ?? [];
      points.push({ x: point.ts, y: point.value });
      if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
      series.set(point.series, points);
    }
    lines = [...lines, ...stream.lines].slice(-MAX_LINES);
    since = stream.seq;

    const seriesCount = series.size;
    const summary = stream.connected
      ? `${lines.length} lines · ${seriesCount} series${stream.dropped ? ` · ${stream.dropped} dropped` : ""}`
      : "stream closed";
    setPeek(summary, !stream.connected && streaming);
    if (stream.dropped > 0) {
      els.note.classList.add("warn");
      els.note.textContent = `${stream.dropped} line(s) dropped by the device buffer — gaps are real`;
    }
    renderLines();
    renderChart();
  }

  async function refresh() {
    if (!streaming) return;
    try {
      const data = await api<{ stream: LogStream }>(`/api/device/logs?since=${since}`);
      absorb(data.stream);
      if (!data.stream.connected) stopPoll();
    } catch (e) {
      stopPoll();
      const msg = e instanceof Error ? e.message : String(e);
      setPeek(msg.length > 48 ? `${msg.slice(0, 45)}…` : msg, true);
      onStatus(msg, true);
    }
  }

  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refresh();
    }, POLL_MS);
  }

  function stopPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    streaming = false;
    els.button.textContent = "start stream";
  }

  async function start() {
    els.button.disabled = true;
    try {
      const data = await api<{
        connected: boolean;
        enabledDebug: boolean;
        restartRequired: boolean;
      }>("/api/device/logs", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      });
      if (!data.connected) throw new Error(data.error ?? "log stream did not open");
      streaming = true;
      els.button.textContent = "stop stream";
      els.note.classList.remove("warn");
      onStatus(
        data.restartRequired
          ? "debug websocket enabled — device restart required"
          : `log stream open${data.enabledDebug ? " (debug enabled on device)" : ""}`,
      );
      await refresh();
      startPoll();
    } catch (e) {
      stopPoll();
      onStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      els.button.disabled = false;
    }
  }

  async function stop() {
    stopPoll();
    els.button.disabled = true;
    try {
      await api("/api/device/logs", {
        method: "POST",
        body: JSON.stringify({ action: "stop" }),
      });
      setPeek("stream closed");
      onStatus("log stream closed");
    } catch (e) {
      onStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      els.button.disabled = false;
    }
  }

  // Filtering is view-only: every line stays in `lines`, so clearing the field
  // brings back what the stream already delivered.
  els.filter.addEventListener("input", renderLines);

  const FOLLOW_KEY = "shelly-devroom.logsPanel.follow";
  els.follow.checked = localStorage.getItem(FOLLOW_KEY) !== "off";
  els.follow.addEventListener("change", () => {
    localStorage.setItem(FOLLOW_KEY, els.follow.checked ? "on" : "off");
    if (els.follow.checked) els.list.scrollTop = els.list.scrollHeight;
  });

  els.button.addEventListener("click", (e) => {
    e.stopPropagation();
    void (streaming ? stop() : start());
  });

  /**
   * Browser-side only: the device keeps its own circular buffer and `since`
   * keeps its place in the stream, so streaming continues uninterrupted and
   * new lines keep arriving after a clear.
   */
  els.clear.addEventListener("click", () => {
    lines = [];
    els.note.classList.remove("warn");
    renderLines();
    setPeek(streaming ? `0 lines · ${series.size} series` : "cleared");
  });

  return { stop };
}
