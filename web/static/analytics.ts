/**
 * Feature events for the hosted demo — "which parts of the app did visitors
 * actually try?", nothing more.
 *
 * Transport is the pageview beacon's own API, not a second one: the collector's
 * `s.js` (deno-kv-analytics) publishes `globalThis.__da.trackEvent(ev, target)`,
 * which GETs its `/e` endpoint with the site id and an opaque base64 payload.
 * So this file has no URL, no site id and no encoding of its own — the beacon
 * script injected by scripts/build-static.mjs is both the switch and the wire.
 * No beacon (a local `mise run start`, a self-built `site/`, a fork, the
 * release binary, and localhost even *with* the tag, which `s.js` itself
 * disables) means `__da` never appears and every `track()` is a no-op.
 *
 * Imported only from `web/static/local-api.ts` (static build only) and
 * `web/static/file-io.ts` (also bundled into the server's web/dist/app.js, via
 * static-file-controls.tsx). In that second build it is dead weight and nothing
 * more, by the same mechanism.
 *
 * What is sent: the literal `"feature"` as the event name and one name from
 * FEATURES below as its target — landing in the collector's `event` /
 * `event_target` dims, next to the `outbound` and `download` events s.js
 * tracks by itself. No source, no script contents, no artifacts, no
 * identifiers; the editor buffer never leaves the browser, which is the whole
 * point of the offline demo.
 *
 * `/api/stats` and `/api/history` are absent on purpose: the dashboard fetches
 * both on mount, so they measure the page loading, not a visitor doing
 * anything. Every name below needs a deliberate action to reach.
 */

/**
 * The closed set of things worth knowing were tried. Deliberately small and
 * hand-listed: an open string channel drifts into per-click telemetry, which is
 * not what this is for. Values stay short — the collector clamps long ones.
 */
export type Feature =
  | "build"
  | "check"
  | "artifact-preview"
  | "artifact-download"
  | "options-change"
  | "script-edit"
  | "checkpoint"
  | "restore"
  | "file-open"
  | "device-attempt";

/** The one event name; the Feature is its target, so `event` stays low-cardinality. */
const EVENT = "feature";

type Collector = { trackEvent?: (ev: string, target?: string) => void };

/** Fired names, so each feature reports once per tab session. */
const fired = new Set<string>();

/** Fired before `s.js` finished loading — flushed on the next successful track. */
const pending: Feature[] = [];

const STORE_KEY = "shellint.static.tracked";

let loaded = false;

/**
 * sessionStorage can throw outright (private mode, `file://`), like every other
 * storage access in web/static/ — the in-memory `fired` set is the fallback and
 * is authoritative within one page load either way.
 */
function loadFired(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) for (const name of JSON.parse(raw) as string[]) fired.add(name);
  } catch {
    /* in-memory only for this page load */
  }
}

function persistFired(): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify([...fired]));
  } catch {
    /* in-memory only for this page load */
  }
}

/** Honoured even though nothing here is a cross-site identifier. */
function optedOut(): boolean {
  return (
    navigator.doNotTrack === "1" ||
    (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  );
}

/** Present only once the deferred beacon has run; absent forever otherwise. */
function collector(): Required<Collector>["trackEvent"] | null {
  const da = (globalThis as { __da?: Collector }).__da;
  return typeof da?.trackEvent === "function" ? da.trackEvent : null;
}

/**
 * Record that a feature was tried. Never throws and never awaits: a dead
 * collector, a blocked script or an offline PWA session must not be observable
 * from the UI, so failures are dropped on the floor.
 *
 * The beacon tag is `defer`, so the very first actions of a session can beat it
 * onto the page; those queue in `pending` (bounded by the Feature union) and go
 * out with the next event rather than being lost.
 */
export function track(name: Feature): void {
  try {
    if (optedOut()) return;
    loadFired();
    if (fired.has(name)) return;
    const send = collector();
    if (!send) {
      if (!pending.includes(name)) pending.push(name);
      return;
    }
    pending.push(name);
    let changed = false;
    for (const queued of pending.splice(0)) {
      if (fired.has(queued)) continue;
      fired.add(queued);
      send(EVENT, queued);
      changed = true;
    }
    if (changed) persistFired();
  } catch {
    /* analytics must never break the app */
  }
}
