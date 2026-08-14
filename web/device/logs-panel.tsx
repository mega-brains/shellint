import { useEffect, useRef, useState } from "preact/hooks";
import { Collapsible } from "../ui/collapsible";
import { Button } from "../ui/button";
import { Sparkline } from "../charts/sparkline";
import type { SparkPoint, SparkSeries } from "../charts/spark";
import type { api as apiFn } from "../lib/api";

type ApiFn = typeof apiFn;

const POLL_MS = 2_000;
const MAX_LINES = 400;
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

export type LogsPanelProps = {
  api: ApiFn;
  onStatus: (msg: string, isError?: boolean) => void;
};

function readFlag(key: string, onValue: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === onValue;
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, on: boolean, onValue: string, offValue: string) {
  try {
    localStorage.setItem(key, on ? onValue : offValue);
  } catch {
    /* ignore */
  }
}

function fmtClock(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function readCollapsed(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writeCollapsed(key: string, collapsed: boolean) {
  try {
    localStorage.setItem(key, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function LogsPanel(props: LogsPanelProps) {
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [seriesMap, setSeriesMap] = useState<Map<string, SparkPoint[]>>(
    () => new Map(),
  );
  const [peek, setPeek] = useState("—");
  const [peekError, setPeekError] = useState(false);
  const [note, setNote] = useState(
    'chart numeric values with print("#m <series> <value>")',
  );
  const [noteWarn, setNoteWarn] = useState(false);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(() =>
    readFlag("shelly-devroom.logsPanel.follow", "on", true),
  );
  const [separate, setSeparate] = useState(() =>
    readFlag("shelly-devroom.logsChart.separate", "1", false),
  );
  const [chartCollapsed, setChartCollapsed] = useState(() =>
    readCollapsed("shelly-devroom.logsChart.collapsed", false),
  );

  const since = useRef(0);
  const streamingRef = useRef(false);
  const listRef = useRef<HTMLOListElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const chart: SparkSeries[] = [...seriesMap.entries()]
    .slice(0, MAX_SERIES)
    .map(([label, points]) => ({ label, points }));

  const chartPeek = chart.length
    ? chart.map((s) => s.label).join(" · ")
    : "no #m series yet";

  const sparkOpts = {
    height: 64,
    formatX: (x: number) => fmtClock(x),
    formatY: (y: number) => (Number.isInteger(y) ? String(y) : y.toFixed(2)),
  };

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (follow) list.scrollTop = list.scrollHeight;
  }, [lines, filter, follow]);

  useEffect(() => {
    if (!streaming) return;
    const tick = async () => {
      if (!streamingRef.current) return;
      try {
        const data = await propsRef.current.api<{ stream: LogStream }>(
          `/api/device/logs?since=${since.current}`,
        );
        absorb(data.stream);
        if (!data.stream.connected) stopStream(false);
      } catch (e) {
        stopStream(false);
        const msg = e instanceof Error ? e.message : String(e);
        setPeek(msg.length > 48 ? `${msg.slice(0, 45)}…` : msg);
        setPeekError(true);
        propsRef.current.onStatus(msg, true);
      }
    };
    void tick();
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void tick();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [streaming]);

  function absorb(stream: LogStream) {
    let seriesCount = 0;
    let lineCount = 0;
    setSeriesMap((prev) => {
      const next = new Map(prev);
      if (stream.dropped > 0) {
        for (const [k, points] of next) {
          const copy = [...points];
          const last = copy[copy.length - 1];
          if (last && last.y !== null) copy.push({ x: last.x, y: null });
          next.set(k, copy);
        }
      }
      for (const point of stream.metrics) {
        const points = [...(next.get(point.series) ?? [])];
        points.push({ x: point.ts, y: point.value });
        if (points.length > MAX_POINTS) {
          points.splice(0, points.length - MAX_POINTS);
        }
        next.set(point.series, points);
      }
      seriesCount = next.size;
      return next;
    });
    setLines((prev) => {
      const next = [...prev, ...stream.lines].slice(-MAX_LINES);
      lineCount = next.length;
      return next;
    });
    since.current = stream.seq;
    setPeek(
      stream.connected
        ? `${lineCount} lines · ${seriesCount} series${stream.dropped ? ` · ${stream.dropped} dropped` : ""}`
        : "stream closed",
    );
    setPeekError(!stream.connected && streamingRef.current);
    if (stream.dropped > 0) {
      setNoteWarn(true);
      setNote(
        `${stream.dropped} line(s) dropped by the device buffer — gaps are real`,
      );
    }
  }

  function stopStream(notify: boolean) {
    streamingRef.current = false;
    setStreaming(false);
    if (notify) setPeek("stream closed");
  }

  async function start() {
    setBusy(true);
    setSeriesMap(new Map());
    try {
      const data = await props.api<{
        connected: boolean;
        enabledDebug: boolean;
        restartRequired: boolean;
        error?: string;
      }>("/api/device/logs", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      });
      if (!data.connected) {
        throw new Error(data.error ?? "log stream did not open");
      }
      streamingRef.current = true;
      setStreaming(true);
      setNoteWarn(false);
      setNote('chart numeric values with print("#m <series> <value>")');
      props.onStatus(
        data.restartRequired
          ? "debug websocket enabled — device restart required"
          : `log stream open${data.enabledDebug ? " (debug enabled on device)" : ""}`,
      );
    } catch (e) {
      stopStream(false);
      props.onStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    stopStream(true);
    setBusy(true);
    try {
      await props.api("/api/device/logs", {
        method: "POST",
        body: JSON.stringify({ action: "stop" }),
      });
      props.onStatus("log stream closed");
    } catch (e) {
      props.onStatus(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  }

  const needle = filter.trim().toLowerCase();
  const visible = lines.slice(-MAX_LINES).filter((line) => {
    if (!needle) return true;
    return `${fmtClock(line.ts)} ${line.text}`.toLowerCase().includes(needle);
  });

  return (
    <Collapsible
      storageKey="shelly-devroom.logsPanel.collapsed"
      defaultCollapsed={true}
      ignoreSelector=".logs-controls"
      panelId="logsPanel"
      panelClass="device"
      bodyId="logsBody"
      headId="logsHead"
      toggleId="logsToggle"
      title="Show or hide the device debug log and the charts parsed from it"
      ariaLabel="Device debug log"
      headChildren={
        <>
          <h2>logs</h2>
          <div class="logs-controls">
            <Button
              id="btnLogs"
              disabled={busy}
              title="Enable sys.debug.websocket on the device and stream ws://<ip>/debug/log"
              onClick={(e) => {
                e.stopPropagation();
                void (streaming ? stop() : start());
              }}
            >
              {streaming ? "stop stream" : "start stream"}
            </Button>
            <Button
              class="logs-clear"
              id="btnLogsClear"
              title="Clear the lines held in the browser — the device buffer is untouched"
              onClick={() => {
                setLines([]);
                setSeriesMap(new Map());
                setNoteWarn(false);
                setNote(
                  'chart numeric values with print("#m <series> <value>")',
                );
                setPeek(streaming ? "0 lines · 0 series" : "cleared");
                setPeekError(false);
              }}
            >
              clear
            </Button>
            <input
              type="search"
              id="logsFilter"
              class="logs-filter"
              placeholder="filter lines…"
              aria-label="Show only log lines containing this text"
              title="Show only log lines containing this text (case-insensitive)"
              value={filter}
              onInput={(e) =>
                setFilter((e.target as HTMLInputElement).value)
              }
            />
            <label class="logs-follow" title="Keep scrolling to the newest line">
              <input
                type="checkbox"
                id="logsFollow"
                checked={follow}
                onChange={(e) => {
                  const on = (e.target as HTMLInputElement).checked;
                  setFollow(on);
                  writeFlag(
                    "shelly-devroom.logsPanel.follow",
                    on,
                    "on",
                    "off",
                  );
                }}
              />
              follow
            </label>
          </div>
          <p class={`panel-peek${peekError ? " error" : ""}`} id="logsPeek">
            {peek}
          </p>
        </>
      }
    >
      <div class="device-body" id="logsBody">
        <p class={`logs-note${noteWarn ? " warn" : ""}`} id="logsNote">
          {note}
        </p>
        <div
          class={`logs-chart${chartCollapsed ? " collapsed" : ""}`}
          id="logsChart"
        >
          <div
            class="panel-head"
            id="logsChartHead"
            role="button"
            tabindex={0}
            aria-expanded={chartCollapsed ? "false" : "true"}
            aria-controls="logsSpark"
            title="Show or hide the chart of #m metric values"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest(".logs-chart-separate")) {
                return;
              }
              const next = !chartCollapsed;
              setChartCollapsed(next);
              writeCollapsed("shelly-devroom.logsChart.collapsed", next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                (e.currentTarget as HTMLElement).click();
              }
            }}
          >
            <span class="panel-toggle" id="logsChartToggle" aria-hidden="true">
              {chartCollapsed ? "▸" : "▾"}
            </span>
            <h2>metrics</h2>
            <span class="logs-chart-peek" id="logsChartPeek">
              {chartPeek}
            </span>
            <label
              class="logs-chart-separate"
              title="Draw each #m series as its own chart, with its own y-scale"
            >
              <input
                type="checkbox"
                id="logsChartSeparate"
                checked={separate}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const on = (e.target as HTMLInputElement).checked;
                  setSeparate(on);
                  writeFlag(
                    "shelly-devroom.logsChart.separate",
                    on,
                    "1",
                    "0",
                  );
                }}
              />
              separate
            </label>
          </div>
          {separate && chart.length > 1 ? (
            <div id="logsSpark" class="spark-grid" aria-label="Numeric series parsed from the debug log">
              {chart.map((s) => (
                <Sparkline key={s.label} series={[s]} options={sparkOpts} />
              ))}
            </div>
          ) : (
            <Sparkline
              id="logsSpark"
              aria-label="Numeric series parsed from the debug log"
              series={chart}
              options={sparkOpts}
            />
          )}
        </div>
        <ol class="logs-list" id="logsList" ref={listRef}>
          {visible.length === 0 && lines.length > 0 ? (
            <li class="empty">{`no line matches “${filter.trim()}”`}</li>
          ) : (
            visible.map((line) => (
              <li
                key={line.seq}
                class={`level-${line.level}${line.text.includes("#m ") ? " metric" : ""}`}
              >
                {`${fmtClock(line.ts)} ${line.text}`}
              </li>
            ))
          )}
        </ol>
      </div>
    </Collapsible>
  );
}
