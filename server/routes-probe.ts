import type { Context, Hono } from "hono";
import {
  getDevice,
  loadDevices,
  mirrorActiveDevice,
  NoDeviceError,
  requireActive,
  setProbeSkip,
  type DeviceRecord,
} from "./devices.ts";
import {
  deleteCapture,
  listCaptures,
  loadCapture,
  probeState,
  resolveCapture,
} from "./probe-store.ts";
import { getProbeProgress, runProbe, type EcoOverride } from "./probe.ts";
import { writeGeneratedTypings } from "./probe-typings.ts";
import { deviceError } from "./routes-device.ts";

/** Only the two documented choices reach `runProbe` — anything else means
 * "leave eco alone", which is also what an absent field means. */
function ecoOverride(v: unknown): EcoOverride | undefined {
  return v === "probe-only" || v === "permanent" ? v : undefined;
}

/** `?device=` (query) resolves to that device; omitted resolves to the active one.
 * Throws `NoDeviceError` only for "no device active" — an unknown `?device=`
 * id resolves to `null` so the route can 404 instead of 409. */
function resolveDevice(c: Context): DeviceRecord | null {
  const deviceId = c.req.query("device");
  return deviceId ? getDevice(deviceId) : requireActive().device;
}

/**
 * The probe-required gate's HTTP surface: read the state, skip it, drop a
 * capture. Split out of routes-device.ts to stay under the 500-line cap
 * (M16 §6). The actual enforcement lives server-side in `deploy.ts` — these
 * routes only let the UI show and manage that gate.
 */
export function registerProbeRoutes(app: Hono) {
  app.get("/api/probe/progress", (c) => {
    return c.json({ ok: true, ...getProbeProgress() });
  });

  app.post("/api/probe", async (c) => {
    let body: { ecoOff?: unknown };
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    try {
      const report = await runProbe({ ecoOff: ecoOverride(body.ecoOff) });
      // Same as `mise run probe`: fresh answers, freshly generated typings.
      const typings = writeGeneratedTypings();
      const deviceId = requireActive().device.id;
      const capture = resolveCapture(deviceId, report.ver);
      return c.json({ ok: true, report, typings, capture, probe: probeState(deviceId) });
    } catch (e) {
      return deviceError(c, e);
    }
  });

  app.get("/api/probe/state", (c) => {
    let device: DeviceRecord | null;
    try {
      device = resolveDevice(c);
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 409);
    }
    if (!device) return c.json({ ok: false, error: "unknown device" }, 404);
    return c.json({ ok: true, ...probeState(device.id), captures: listCaptures(device.id) });
  });

  /**
   * The last capture on disk for this device, full results included — the probe
   * log is in-memory in the browser, so without this a page reload leaves it
   * empty even though the answers are stored. Prefers the capture matching the
   * firmware the device reports now, else the newest one.
   */
  app.get("/api/probe/last", (c) => {
    let device: DeviceRecord | null;
    try {
      device = resolveDevice(c);
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 409);
    }
    if (!device) return c.json({ ok: false, error: "unknown device" }, 404);
    const state = probeState(device.id);
    const meta = state.matched ?? state.newest;
    if (!meta) return c.json({ ok: true, capture: null, report: null });
    return c.json({ ok: true, capture: meta, report: loadCapture(device.id, meta.verKey) });
  });

  app.post("/api/probe/skip", async (c) => {
    let body: { device?: string; ver?: string | null };
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    let device: DeviceRecord | null;
    try {
      device = body.device ? getDevice(body.device) : requireActive().device;
    } catch (e) {
      if (e instanceof NoDeviceError) return c.json({ ok: false, error: e.message }, 409);
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
    if (!device) return c.json({ ok: false, error: `unknown device "${body.device}"` }, 404);
    const ver = body.ver !== undefined ? body.ver : (device.info?.ver ?? null);
    setProbeSkip(device.id, ver);
    return c.json({ ok: true, ...probeState(device.id), captures: listCaptures(device.id) });
  });

  app.delete("/api/probe/captures/:verKey", (c) => {
    let device: DeviceRecord | null;
    try {
      device = resolveDevice(c);
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 409);
    }
    if (!device) return c.json({ ok: false, error: "unknown device" }, 404);
    try {
      deleteCapture(device.id, c.req.param("verKey"));
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
    }
    // The deleted capture may have been what the mirror was showing.
    if (loadDevices().active?.device === device.id) mirrorActiveDevice(device.id);
    return c.json({ ok: true, ...probeState(device.id), captures: listCaptures(device.id) });
  });
}
