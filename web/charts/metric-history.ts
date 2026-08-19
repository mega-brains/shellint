import type { SparkPoint } from "./spark";

/**
 * A few minutes of a polled telemetry value, kept in localStorage so a reload
 * does not blank the chart. Deliberately not server-side history: these are
 * live diagnostics, not build metrics, and they must not grow without bound.
 */
export const WINDOW_MS = 5 * 60 * 1000;

const PREFIX = "shellint.history.";

export type MetricHistory = {
  read(now?: number): SparkPoint[];
  /** `null` records a missing poll/sensor so the chart can hatch the gap. */
  push(value: number | null, now?: number): SparkPoint[];
};

function prune(points: SparkPoint[], now: number): SparkPoint[] {
  return points.filter((p) => now - p.x <= WINDOW_MS);
}

function parse(raw: string | null): SparkPoint[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is SparkPoint =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as SparkPoint).x === "number" &&
        (typeof (p as SparkPoint).y === "number" || (p as SparkPoint).y === null),
    );
  } catch {
    return [];
  }
}

export function createHistory(name: string): MetricHistory {
  const key = PREFIX + name;
  /** Fallback when localStorage is unavailable (private mode, quota, file://). */
  let memory: SparkPoint[] = [];

  function save(points: SparkPoint[]): void {
    memory = points;
    try {
      localStorage.setItem(key, JSON.stringify(points));
    } catch {
      /* the memory copy is the fallback */
    }
  }

  function read(now = Date.now()): SparkPoint[] {
    let stored: SparkPoint[];
    try {
      stored = parse(localStorage.getItem(key));
    } catch {
      stored = memory;
    }
    const kept = prune(stored, now);
    if (kept.length !== stored.length) save(kept);
    return kept;
  }

  return {
    read,
    /**
     * A gap wider than the window means the page was away long enough that a
     * line between the two samples would be a lie, so the series breaks.
     */
    push(value, now = Date.now()) {
      const points = read(now);
      const last = points[points.length - 1];
      if (last && last.y !== null && now - last.x > WINDOW_MS) {
        points.push({ x: last.x, y: null });
      }
      points.push({ x: now, y: value });
      const kept = prune(points, now);
      save(kept);
      return kept;
    },
  };
}
