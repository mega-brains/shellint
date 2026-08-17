import type { Context, Hono } from "hono";
import { runtime } from "#devroom/runtime";
import { CompilerNotWiredError } from "../core/config.ts";
import {
  addDevice,
  DuplicateDeviceError,
  getDevice,
  listDevices,
  loadDevices,
  NoDeviceError,
  removeDevice,
  requireActive,
  resolveTarget,
  sanitizeDevice,
  setActive,
  toDeviceInfo,
  touchDeviceInfo,
  updateDevice,
} from "./devices.ts";
import { probeState, resolveCapture } from "../probe/probe-store.ts";
import {
  createSlot,
  deleteSlot,
  getSlotCode,
  listSlots,
} from "./device-scripts.ts";
import { ShellyRpc } from "./rpc.ts";
import { deploy, AuthNotSupportedError, AuthFailedError, ProbeRequiredError } from "./deploy.ts";
import {
  fetchDeviceStatus,
  fetchEcoMode,
  rebootDevice,
  setEcoMode,
  setScriptRunning,
} from "./device-status.ts";
import {
  readLogs,
  resetForDeviceSwitch,
  startLogStream,
  stopLogStream,
} from "./debug-log.ts";
import { expandLogText, loadLogMap } from "../script/log-map.ts";
import { writeGeneratedTypings } from "../probe/probe-typings.ts";

/**
 * Shared error → response mapping for every route that talks to a device:
 * `NoDeviceError` → 409, `AuthFailedError` → 401 (wrong password),
 * `AuthNotSupportedError` → 401 (non-digest challenge), `CompilerNotWiredError`
 * → 400, everything else → 500.
 */
export async function deviceError(c: Context, e: unknown) {
  if (e instanceof NoDeviceError) {
    return c.json({ ok: false, error: e.message }, 409);
  }
  if (e instanceof ProbeRequiredError) {
    return c.json(
      {
        ok: false,
        error: e.message,
        code: "probe-required",
        probe: await probeState(e.deviceId),
      },
      409,
    );
  }
  if (e instanceof AuthFailedError) {
    return c.json({ ok: false, error: e.message }, 401);
  }
  if (e instanceof AuthNotSupportedError) {
    return c.json({ ok: false, error: "auth not supported yet" }, 401);
  }
  if (e instanceof CompilerNotWiredError) {
    return c.json({ ok: false, error: e.message }, 400);
  }
  return c.json(
    { ok: false, error: e instanceof Error ? e.message : String(e) },
    500,
  );
}

/** Device telemetry, logs, probe, deploy. Split out of app.ts to stay under the 500-line cap. */
export function registerDeviceRoutes(app: Hono) {
  app.get("/api/devices", async (c) => {
    const file = await loadDevices();
    const devices = await listDevices();
    return c.json({
      ok: true,
      devices: await Promise.all(devices.map(sanitizeDevice)),
      active: file.active,
    });
  });

  app.post("/api/devices", async (c) => {
    let body: { ip?: string; label?: string; password?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { ok: false, error: "expected JSON body { ip, label?, password? }" },
        400,
      );
    }
    if (typeof body.ip !== "string" || body.ip.length === 0) {
      return c.json({ ok: false, error: "body.ip must be a non-empty string" }, 400);
    }
    try {
      const device = await addDevice({
        ip: body.ip,
        label: typeof body.label === "string" ? body.label : undefined,
        password: typeof body.password === "string" ? body.password : undefined,
      });
      return c.json({ ok: true, device: await sanitizeDevice(device) });
    } catch (e) {
      if (e instanceof DuplicateDeviceError) {
        return c.json({ ok: false, error: e.message }, 409);
      }
      return await deviceError(c, e);
    }
  });

  app.patch("/api/devices/:id", async (c) => {
    let body: { label?: string; ip?: string; password?: string | null };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "expected JSON body" }, 400);
    }
    try {
      const device = await updateDevice(c.req.param("id"), body);
      return c.json({ ok: true, device: await sanitizeDevice(device) });
    } catch (e) {
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        404,
      );
    }
  });

  app.delete("/api/devices/:id", async (c) => {
    await removeDevice(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/devices/:id/test", async (c) => {
    const id = c.req.param("id");
    let target;
    try {
      target = await resolveTarget(id);
    } catch (e) {
      return await deviceError(c, e);
    }
    const rpc = new ShellyRpc(target);
    const t0 = performance.now();
    try {
      await rpc.connect();
      const info = ((await rpc.call("Shelly.GetDeviceInfo", {})) ?? {}) as Record<
        string,
        unknown
      >;
      await touchDeviceInfo(id, toDeviceInfo(info));
      return c.json({
        ok: true,
        online: true,
        info,
        latencyMs: Math.round(performance.now() - t0),
      });
    } catch (e) {
      if (e instanceof AuthFailedError || e instanceof AuthNotSupportedError) {
        return await deviceError(c, e);
      }
      return c.json({
        ok: true,
        online: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      rpc.close();
    }
  });

  app.post("/api/session/active", async (c) => {
    let body: { device?: string; slot?: number; script?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { ok: false, error: "expected JSON body { device?, slot?, script? }" },
        400,
      );
    }
    try {
      const target = await setActive(body);
      // A new active device means the old one's log ring must not bleed into it.
      resetForDeviceSwitch();
      // Same shape as `/api/devices` — a device *id*, not the record (which
      // carries `auth.password` and would blank the header pickers).
      return c.json({
        ok: true,
        active: { device: target.device.id, slot: target.slot, script: target.script },
        probe: await probeState(target.device.id),
      });
    } catch (e) {
      return await deviceError(c, e);
    }
  });

  app.get("/api/device/scripts", async (c) => {
    const deviceId = c.req.query("device");
    let target;
    let device;
    try {
      target = await resolveTarget(deviceId);
      device = deviceId ? await getDevice(deviceId) : (await requireActive()).device;
    } catch (e) {
      return await deviceError(c, e);
    }
    const rpc = new ShellyRpc(target);
    try {
      await rpc.connect();
      const slots = await listSlots(rpc, device ?? undefined);
      return c.json({ ok: true, slots });
    } catch (e) {
      return await deviceError(c, e);
    } finally {
      rpc.close();
    }
  });

  app.get("/api/device/script/code", async (c) => {
    const deviceId = c.req.query("device");
    const slotRaw = Number(c.req.query("slot"));
    if (!Number.isFinite(slotRaw)) {
      return c.json({ ok: false, error: "?slot= must be a number" }, 400);
    }
    let target;
    try {
      target = await resolveTarget(deviceId);
    } catch (e) {
      return await deviceError(c, e);
    }
    const rpc = new ShellyRpc(target);
    try {
      await rpc.connect();
      const code = await getSlotCode(rpc, slotRaw);
      return c.json({
        ok: true,
        slot: slotRaw,
        bytes: runtime.byteLength(code),
        code,
      });
    } catch (e) {
      return await deviceError(c, e);
    } finally {
      rpc.close();
    }
  });

  app.post("/api/device/scripts", async (c) => {
    let body: { name?: string; device?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "expected JSON body { name }" }, 400);
    }
    if (typeof body.name !== "string" || body.name.length === 0) {
      return c.json({ ok: false, error: "body.name must be a non-empty string" }, 400);
    }
    let target;
    try {
      target = await resolveTarget(body.device);
    } catch (e) {
      return await deviceError(c, e);
    }
    const rpc = new ShellyRpc(target);
    try {
      await rpc.connect();
      const slot = await createSlot(rpc, body.name);
      return c.json({ ok: true, slot });
    } catch (e) {
      return await deviceError(c, e);
    } finally {
      rpc.close();
    }
  });

  app.delete("/api/device/scripts/:slot", async (c) => {
    const slotRaw = Number(c.req.param("slot"));
    if (!Number.isFinite(slotRaw)) {
      return c.json({ ok: false, error: "slot must be a number" }, 400);
    }
    const deviceId = c.req.query("device");
    let target;
    try {
      target = await resolveTarget(deviceId);
    } catch (e) {
      return await deviceError(c, e);
    }
    const rpc = new ShellyRpc(target);
    try {
      await rpc.connect();
      await deleteSlot(rpc, slotRaw);
      return c.json({ ok: true });
    } catch (e) {
      return await deviceError(c, e);
    } finally {
      rpc.close();
    }
  });

  app.get("/api/device/logs", async (c) => {
    const sinceRaw = Number(c.req.query("since"));
    const since = Number.isFinite(sinceRaw) ? Math.max(0, sinceRaw) : 0;
    const stream = readLogs(since);
    // Prod builds ship shortened log strings; the viewer is the other half of
    // that trade, so ids become readable again here rather than on the device.
    const map = await loadLogMap();
    const lines = stream.lines.map((l) => ({
      ...l,
      text: expandLogText(l.text, map),
    }));
    return c.json({ ok: true, stream: { ...stream, lines } });
  });

  app.post("/api/device/logs", async (c) => {
    let action = "start";
    try {
      const body = (await c.req.json()) as { action?: unknown };
      if (body.action === "stop") action = "stop";
    } catch {
      /* default to start */
    }
    if (action === "stop") {
      stopLogStream();
      return c.json({ ok: true, connected: false });
    }
    try {
      return c.json({ ok: true, ...(await startLogStream()) });
    } catch (e) {
      return deviceError(c, e);
    }
  });

  app.post("/api/deploy", async (c) => {
    let body: {
      mode?: string;
      minify?: string;
      device?: string;
      slot?: number;
      script?: string;
      createName?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          ok: false,
          error:
            'expected JSON body { mode: "debug"|"prod", minify?: "min"|"raw" }',
        },
        400,
      );
    }
    const mode = body.mode;
    if (mode !== "debug" && mode !== "prod") {
      return c.json({ ok: false, error: 'mode must be "debug" or "prod"' }, 400);
    }
    const minify = body.minify ?? "min";
    if (minify !== "min" && minify !== "raw") {
      return c.json(
        { ok: false, error: 'minify must be "min" or "raw"' },
        400,
      );
    }
    try {
      let lastStatus = "starting";
      const result = await deploy(
        mode,
        (msg) => {
          lastStatus = msg;
        },
        minify,
        {
          deviceId: body.device,
          slot: body.slot,
          scriptKey: body.script,
          createName: body.createName,
        },
      );
      return c.json({
        ok: true,
        ...result,
        status: lastStatus === "running" ? "running" : lastStatus,
      });
    } catch (e) {
      return deviceError(c, e);
    }
  });

  app.get("/api/device/status", async (c) => {
    try {
      const status = await fetchDeviceStatus();
      return c.json({ ok: true, status });
    } catch (e) {
      return deviceError(c, e);
    }
  });

  app.post("/api/device/script", async (c) => {
    let body: { running?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { ok: false, error: "expected JSON body { running: boolean }" },
        400,
      );
    }
    if (typeof body.running !== "boolean") {
      return c.json({ ok: false, error: "running must be a boolean" }, 400);
    }
    try {
      return c.json({ ok: true, ...(await setScriptRunning(body.running)) });
    } catch (e) {
      return deviceError(c, e);
    }
  });

  /** One `Sys.GetConfig` — the probe's eco prompt, which must not pay for a
   * full status poll just to decide whether to warn. */
  app.get("/api/device/eco", async (c) => {
    try {
      return c.json({ ok: true, ...(await fetchEcoMode()) });
    } catch (e) {
      return deviceError(c, e);
    }
  });

  app.post("/api/device/eco", async (c) => {
    let body: { eco_mode?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { ok: false, error: "expected JSON body { eco_mode: boolean }" },
        400,
      );
    }
    if (typeof body.eco_mode !== "boolean") {
      return c.json({ ok: false, error: "eco_mode must be a boolean" }, 400);
    }
    try {
      const result = await setEcoMode(body.eco_mode);
      return c.json({ ok: true, ...result });
    } catch (e) {
      return deviceError(c, e);
    }
  });

  /** Soft reboot — `Shelly.Reboot`, not factory reset. */
  app.post("/api/device/reboot", async (c) => {
    try {
      await rebootDevice();
      return c.json({ ok: true });
    } catch (e) {
      return deviceError(c, e);
    }
  });
}
