/**
 * `.devroom/devices.json` load/migration/CRUD + digest auth math.
 * Touches the real `devroom.json` and `.devroom/devices.json`, so both are
 * backed up and restored — migration is driven off a fixture, never the
 * user's real device IPs.
 * Usage: node --import tsx scripts/test-devices.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT, DEVICE_PROFILE_PATH, PROBE_PATH, devicePaths } from "../server/paths.ts";
import {
  _resetCache,
  addDevice,
  DuplicateDeviceError,
  loadDevices,
  NoDeviceError,
  mirrorActiveDevice,
  removeDevice,
  requireActive,
  resolveTarget,
  setActive,
} from "../server/devices.ts";
import {
  computeDigestResponse,
  NonceCounter,
} from "../server/auth-digest.ts";
import { resetForDeviceSwitch, readLogs } from "../server/debug-log.ts";
import { GENERATED_DTS_PATH } from "../server/probe-typings.ts";
import { createApp } from "../server/app.ts";

const DEVROOM_JSON = join(ROOT, "devroom.json");
const DEVICES_DIR = join(ROOT, ".devroom");
const DEVICES_FILE = join(DEVICES_DIR, "devices.json");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const originalDevroom = existsSync(DEVROOM_JSON) ? readFileSync(DEVROOM_JSON, "utf8") : null;
const originalDevices = existsSync(DEVICES_FILE) ? readFileSync(DEVICES_FILE, "utf8") : null;
const originalProfileMirror = existsSync(DEVICE_PROFILE_PATH)
  ? readFileSync(DEVICE_PROFILE_PATH, "utf8")
  : null;
const originalProbeMirror = existsSync(PROBE_PATH) ? readFileSync(PROBE_PATH, "utf8") : null;
const originalGeneratedDts = existsSync(GENERATED_DTS_PATH)
  ? readFileSync(GENERATED_DTS_PATH, "utf8")
  : null;
const devicesSubdir = join(DEVICES_DIR, "devices");
const originalDevicesSubdirExisted = existsSync(devicesSubdir);

function restore() {
  if (originalDevroom !== null) writeFileSync(DEVROOM_JSON, originalDevroom, "utf8");
  if (originalDevices !== null) {
    mkdirSync(DEVICES_DIR, { recursive: true });
    writeFileSync(DEVICES_FILE, originalDevices, "utf8");
  } else {
    rmSync(DEVICES_FILE, { force: true });
  }
  if (originalProfileMirror !== null) {
    writeFileSync(DEVICE_PROFILE_PATH, originalProfileMirror, "utf8");
  } else {
    rmSync(DEVICE_PROFILE_PATH, { force: true });
  }
  if (originalProbeMirror !== null) {
    writeFileSync(PROBE_PATH, originalProbeMirror, "utf8");
  } else {
    rmSync(PROBE_PATH, { force: true });
  }
  if (originalGeneratedDts !== null) {
    writeFileSync(GENERATED_DTS_PATH, originalGeneratedDts, "utf8");
  } else {
    rmSync(GENERATED_DTS_PATH, { force: true });
  }
  if (!originalDevicesSubdirExisted) rmSync(devicesSubdir, { recursive: true, force: true });
  _resetCache();
}

function setDevroom(obj) {
  writeFileSync(DEVROOM_JSON, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function setDevicesFile(obj) {
  mkdirSync(DEVICES_DIR, { recursive: true });
  if (obj === null) {
    rmSync(DEVICES_FILE, { force: true });
  } else {
    writeFileSync(DEVICES_FILE, typeof obj === "string" ? obj : JSON.stringify(obj), "utf8");
  }
}

function fakeRpcFactory({ failConnect = false, info = {} } = {}) {
  return () => ({
    async connect() {
      if (failConnect) throw new Error("offline (test)");
    },
    async call(method) {
      if (method === "Shelly.GetDeviceInfo") return info;
      return {};
    },
    close() {},
  });
}

try {
  // --- absent devices.json, absent legacy config -> empty, no throw ---
  setDevicesFile(null);
  setDevroom({});
  _resetCache();
  let file = loadDevices();
  if (file.devices.length !== 0 || file.active !== null) {
    fail(`expected empty devices file with no legacy config, got ${JSON.stringify(file)}`);
  }

  // --- corrupt devices.json tolerated, never throws at startup ---
  setDevicesFile("{ not json");
  setDevroom({});
  _resetCache();
  file = loadDevices();
  if (file.devices.length !== 0 || file.active !== null) {
    fail("corrupt devices.json should fall back to an empty file, not throw");
  }

  // --- migration from legacy devroom.json (deviceIp + deviceIp2 + scriptId) ---
  setDevicesFile(null);
  setDevroom({
    deviceIp: "192.0.2.10",
    deviceIp2: "192.0.2.20",
    scriptId: 3,
    host: "0.0.0.0",
    port: 8787,
    compiler: "devroom",
  });
  _resetCache();
  file = loadDevices();
  if (file.devices.length !== 2) {
    fail(`expected migration to create 2 devices, got ${file.devices.length}`);
  }
  const primary = file.devices.find((d) => d.ip === "192.0.2.10");
  const secondary = file.devices.find((d) => d.ip === "192.0.2.20");
  if (!primary || !secondary) fail("migration should carry over both deviceIp and deviceIp2");
  if (!file.active || file.active.device !== primary.id || file.active.slot !== 3) {
    fail(`expected active to point at the primary device on slot 3, got ${JSON.stringify(file.active)}`);
  }
  // Idempotent: devices.json now exists on disk, re-loading must not re-migrate.
  _resetCache();
  const reloaded = loadDevices();
  if (reloaded.devices.length !== 2) fail("re-loading migrated devices.json should be a no-op");

  // --- resolveTarget() with no devices throws NoDeviceError ---
  setDevicesFile({ version: 1, active: null, devices: [] });
  _resetCache();
  try {
    requireActive();
    fail("requireActive() should throw NoDeviceError when no device is active");
  } catch (e) {
    if (!(e instanceof NoDeviceError)) fail(`expected NoDeviceError, got ${e}`);
  }
  try {
    resolveTarget();
    fail("resolveTarget() should throw NoDeviceError when no device is active");
  } catch (e) {
    if (!(e instanceof NoDeviceError)) fail(`expected NoDeviceError, got ${e}`);
  }

  // --- addDevice: offline add falls back to slug(ip) id ---
  setDevicesFile({ version: 1, active: null, devices: [] });
  _resetCache();
  const offlineDevice = await addDevice(
    { ip: "10.0.0.5", label: "Garage" },
    fakeRpcFactory({ failConnect: true }),
  );
  if (offlineDevice.id !== "garage") {
    fail(`expected offline add to slug the label, got id ${offlineDevice.id}`);
  }

  // --- addDevice: successful probe uses the device's own id, not the slug ---
  const onlineDevice = await addDevice(
    { ip: "10.0.0.6", label: "Kitchen" },
    fakeRpcFactory({ info: { id: "shellyplus1pm-abc123", model: "SNSW-001P16EU", gen: 2 } }),
  );
  if (onlineDevice.id !== "shellyplus1pm-abc123") {
    fail(`expected online add to use the probed device id, got ${onlineDevice.id}`);
  }
  if (onlineDevice.info?.model !== "SNSW-001P16EU") {
    fail("expected probed model to be stored on the device record");
  }

  // --- duplicate-ip add rejected ---
  try {
    await addDevice({ ip: "10.0.0.5", label: "Garage 2" }, fakeRpcFactory({ failConnect: true }));
    fail("adding a device with a duplicate ip should be rejected");
  } catch (e) {
    if (!(e instanceof DuplicateDeviceError)) fail(`expected DuplicateDeviceError, got ${e}`);
  }

  // --- removeDevice of the active device clears active, not dangling ---
  setActive({ device: offlineDevice.id, slot: 1, script: "main" });
  if (loadDevices().active?.device !== offlineDevice.id) fail("setActive did not take effect");
  removeDevice(offlineDevice.id);
  if (loadDevices().active !== null) {
    fail("removing the active device should clear active, not leave it dangling");
  }
  if (loadDevices().devices.some((d) => d.id === offlineDevice.id)) {
    fail("removeDevice should remove the device record");
  }

  // --- HTTP: GET/POST/PATCH/DELETE /api/devices ---
  setDevicesFile({ version: 1, active: null, devices: [] });
  _resetCache();
  const app = createApp();

  const listEmpty = await (await app.request("/api/devices")).json();
  if (!listEmpty.ok || listEmpty.devices.length !== 0) fail("expected empty device list over HTTP");

  // Port 9 (discard) on loopback — nobody listens, so the connect fails fast
  // rather than waiting out the full connect timeout.
  const addRes = await app.request("/api/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ip: "127.0.0.1:9", label: "Test device" }),
  });
  const added = await addRes.json();
  if (!added.ok || added.device.hasPassword) {
    fail(`expected POST /api/devices to add an offline device, got ${JSON.stringify(added)}`);
  }
  if ("password" in added.device || "auth" in added.device) {
    fail("device response over HTTP must never carry the raw auth object");
  }
  const addedId = added.device.id;

  const patchRes = await app.request(`/api/devices/${addedId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "Renamed" }),
  });
  const patched = await patchRes.json();
  if (!patched.ok || patched.device.label !== "Renamed") fail("PATCH /api/devices/:id did not rename");

  const delRes = await app.request(`/api/devices/${addedId}`, { method: "DELETE" });
  if (!(await delRes.json()).ok) fail("DELETE /api/devices/:id failed");
  const listAfterDelete = await (await app.request("/api/devices")).json();
  if (listAfterDelete.devices.some((d) => d.id === addedId)) {
    fail("device should be gone after DELETE");
  }

  // --- switch cases: setActive() mirrors the newly active device's cached
  // profile/probe into types/, and resets the log ring generation ---
  setDevicesFile({ version: 1, active: null, devices: [] });
  _resetCache();
  const deviceA = await addDevice({ ip: "10.0.1.1", label: "Device A" }, fakeRpcFactory({ failConnect: true }));
  const deviceB = await addDevice({ ip: "10.0.1.2", label: "Device B" }, fakeRpcFactory({ failConnect: true }));

  // Seed device A's per-device cache directly (as if a prior profile fetch/probe ran).
  mkdirSync(dirname(devicePaths(deviceA.id).profile), { recursive: true });
  writeFileSync(
    devicePaths(deviceA.id).profile,
    JSON.stringify({ at: "t", deviceIp: deviceA.ip, gen: 2, ver: "1.0.0", model: "M-A", app: null, methods: [], components: [] }),
    "utf8",
  );

  setActive({ device: deviceA.id, slot: 1, script: "main" });
  if (!existsSync(DEVICE_PROFILE_PATH)) fail("mirrorActiveDevice should copy device A's cached profile to the mirror");
  let mirrored = JSON.parse(readFileSync(DEVICE_PROFILE_PATH, "utf8"));
  if (mirrored.model !== "M-A") fail(`expected mirror to reflect device A, got ${JSON.stringify(mirrored)}`);

  // Device B has no cached profile yet -> switching to it must not leave A's mirror behind.
  setActive({ device: deviceB.id, slot: 1, script: "main" });
  if (existsSync(DEVICE_PROFILE_PATH)) {
    fail("switching to a device with no cached profile should remove the stale mirror");
  }

  // Explicit mirrorActiveDevice() call (as fetchDeviceProfile/runProbe use internally) is idempotent.
  mirrorActiveDevice(deviceB.id);
  if (existsSync(DEVICE_PROFILE_PATH)) fail("mirrorActiveDevice should stay a no-op mirror removal for an uncached device");

  // Log ring: resetForDeviceSwitch() bumps deviceGeneration so a poller sees the switch.
  const before = readLogs(0).deviceGeneration;
  resetForDeviceSwitch();
  const after = readLogs(0).deviceGeneration;
  if (after <= before) fail(`expected deviceGeneration to increase after a switch, got ${before} -> ${after}`);
  if (readLogs(0).lines.length !== 0) fail("resetForDeviceSwitch should wipe buffered lines");

  // --- digest auth: known vector locks the formula against a refactor ---
  const realm = "shellyplus1pm-441793a1b2c3";
  const nonce = 1234567890;
  const cnonce = "abcdef0123456789";
  const nc = "00000001";
  const password = "secret";
  const response = computeDigestResponse({ realm, nonce, cnonce, nc, password });
  // ha1 = SHA256("admin:shellyplus1pm-441793a1b2c3:secret")
  // ha2 = SHA256("dummy_method:dummy_uri")
  // response = SHA256(ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":auth:" + ha2)
  if (response !== "5498900e699dc9918e7c3a1ecb245ac1059222cbf7fa4c61febd0d650bbac33f") {
    fail(`digest response mismatch: got ${response}`);
  }
  if (response.length !== 64) fail("digest response should be a 64-char hex sha256");

  // --- NonceCounter: increments per use, resets on stale ---
  const counter = new NonceCounter();
  const nc1 = counter.next(nonce);
  const nc2 = counter.next(nonce);
  if (nc1 !== "00000001" || nc2 !== "00000002") {
    fail(`expected nc to increment 00000001 -> 00000002, got ${nc1} -> ${nc2}`);
  }
  counter.reset();
  const ncAfterReset = counter.next(nonce);
  if (ncAfterReset !== "00000001") fail("nc should restart at 00000001 after reset (stale challenge)");

  console.log("OK: devices load/migration/CRUD, digest auth vector, nc increment/reset");
} finally {
  restore();
}
