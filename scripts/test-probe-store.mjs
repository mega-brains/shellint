/**
 * Per-(device, firmware) probe capture store: verKey sanitization, the §3.4
 * legacy migration, capture CRUD, `probeState`'s truth table, and
 * `mirrorActiveDevice`'s firmware-aware fallback. Touches the real
 * `.devroom/devices.json` and `types/` mirrors, so both are backed up and
 * restored — same pattern as `test-devices.mjs`, scoped to fake device ids
 * that never collide with a real one.
 * Usage: node --import tsx scripts/test-probe-store.mjs
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { ROOT, DEVICE_PROFILE_PATH, PROBE_PATH, devicePaths } from "../server/core/paths.ts";
import {
  _resetCache,
  addDevice,
  clearProbeSkip,
  mirrorActiveDevice,
  setActive,
  setProbeSkip,
} from "../server/device/devices.ts";
import { GENERATED_DTS_PATH } from "../server/probe/probe-typings.ts";
import {
  deleteCapture,
  listCaptures,
  newestCapture,
  probeState,
  resolveCapture,
  verKeyOf,
  writeCapture,
} from "../server/probe/probe-store.ts";

const DEVICES_DIR = join(ROOT, ".devroom");
const DEVICES_FILE = join(DEVICES_DIR, "devices.json");
const FAKE_IDS = ["probe-store-test-a", "probe-store-test-b"];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const originalDevices = existsSync(DEVICES_FILE) ? readFileSync(DEVICES_FILE, "utf8") : null;
const originalProfileMirror = existsSync(DEVICE_PROFILE_PATH)
  ? readFileSync(DEVICE_PROFILE_PATH, "utf8")
  : null;
const originalProbeMirror = existsSync(PROBE_PATH) ? readFileSync(PROBE_PATH, "utf8") : null;
const originalGeneratedDts = existsSync(GENERATED_DTS_PATH)
  ? readFileSync(GENERATED_DTS_PATH, "utf8")
  : null;

function restore() {
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
  for (const id of FAKE_IDS) {
    rmSync(join(DEVICES_DIR, "devices", id), { recursive: true, force: true });
  }
  _resetCache();
}

function setDevicesFile(obj) {
  mkdirSync(DEVICES_DIR, { recursive: true });
  writeFileSync(DEVICES_FILE, JSON.stringify(obj), "utf8");
}

function fakeRpcFactory(info) {
  return () => ({
    async connect() {},
    async call(method) {
      return method === "Shelly.GetDeviceInfo" ? info : {};
    },
    close() {},
  });
}

function makeReport(deviceIp, ver, deviceId, resultForAbsent = "undefined") {
  return {
    probed: true,
    at: new Date().toISOString(),
    deviceIp,
    deviceId,
    ver,
    model: "M-TEST",
    gen: 2,
    scriptId: 1,
    configuredScriptId: 1,
    strategy: "configured",
    existingScriptIds: [1],
    scratchScriptId: null,
    scratchRemoved: false,
    notes: [],
    results: [
      { id: "array.map", ok: true, result: "function" },
      { id: "string.padStart", ok: true, result: resultForAbsent },
    ],
  };
}

try {
  restore(); // start from a clean slate for the fake ids

  // --- verKeyOf: sanitization, cap, pathological inputs never escape the dir ---
  if (verKeyOf("1.4.4") !== "1.4.4") fail("verKeyOf should pass through a clean version");
  if (verKeyOf("1.6.0-rc1") !== "1.6.0-rc1") fail("verKeyOf should keep hyphens");
  if (verKeyOf(null) !== "unknown") fail("verKeyOf(null) should be \"unknown\"");
  if (verKeyOf("") !== "unknown") fail("verKeyOf(\"\") should be \"unknown\"");
  if (verKeyOf("..") !== "unknown") fail('verKeyOf("..") should collapse to "unknown"');
  // The dots survive sanitization (they are a legal version-string char), but
  // the slashes must not — and the whole token must never equal "..".
  const traversal = verKeyOf("../etc/passwd");
  if (traversal.includes("/") || traversal === "..") {
    fail(`verKeyOf must strip path separators, got ${JSON.stringify(traversal)}`);
  }
  const long = verKeyOf("x".repeat(200));
  if (long.length > 40) fail(`verKeyOf must cap length, got ${long.length}`);
  if (verKeyOf("1.4.4") === verKeyOf("1.4.5")) fail("distinct versions must not collide");

  // --- migration: legacy probe.json with its own ver ---
  {
    const id = FAKE_IDS[0];
    const paths = devicePaths(id);
    mkdirSync(dirname(paths.probe), { recursive: true });
    writeFileSync(
      paths.probe,
      JSON.stringify({ probed: true, at: "t1", deviceIp: "10.9.9.1", ver: "1.2.3", results: [] }),
      "utf8",
    );
    const captures = listCaptures(id);
    if (captures.length !== 1 || captures[0].verKey !== "1.2.3") {
      fail(`migration should key by the legacy capture's own ver, got ${JSON.stringify(captures)}`);
    }
    if (!existsSync(paths.probe)) fail("migration must leave the legacy file in place");
    // idempotent: running it again changes nothing.
    const again = listCaptures(id);
    if (again.length !== 1) fail("migration should not duplicate on a second read");
    rmSync(paths.probesDir, { recursive: true, force: true });
    rmSync(paths.profile, { force: true });
    rmSync(paths.probe, { force: true });
  }

  // --- migration: legacy probe.json without ver, matching profile.json supplies it ---
  {
    const id = FAKE_IDS[0];
    const paths = devicePaths(id);
    mkdirSync(dirname(paths.profile), { recursive: true });
    writeFileSync(
      paths.profile,
      JSON.stringify({ at: "t", deviceIp: "10.9.9.1", ver: "2.0.0", model: "M", app: null, methods: [], components: [] }),
      "utf8",
    );
    writeFileSync(
      paths.probe,
      JSON.stringify({ probed: true, at: "t1", deviceIp: "10.9.9.1", results: [] }),
      "utf8",
    );
    const captures = listCaptures(id);
    if (captures.length !== 1 || captures[0].verKey !== "2.0.0") {
      fail(`migration should borrow the matching profile's ver, got ${JSON.stringify(captures)}`);
    }
    rmSync(paths.probesDir, { recursive: true, force: true });
  }

  // --- migration: legacy probe.json without ver, non-matching profile -> "unknown" ---
  {
    const id = FAKE_IDS[0];
    const paths = devicePaths(id);
    writeFileSync(
      paths.probe,
      JSON.stringify({ probed: true, at: "t1", deviceIp: "10.9.9.99", results: [] }),
      "utf8",
    );
    const captures = listCaptures(id);
    if (captures.length !== 1 || captures[0].verKey !== "unknown") {
      fail(`non-matching profile should fall back to "unknown", got ${JSON.stringify(captures)}`);
    }
    rmSync(paths.probesDir, { recursive: true, force: true });
    rmSync(paths.profile, { force: true });
    rmSync(paths.probe, { force: true });
  }

  // --- writeCapture / resolveCapture / newestCapture / deleteCapture ---
  {
    const id = FAKE_IDS[0];
    const r144 = makeReport("10.9.9.1", "1.4.4", id);
    writeCapture(id, r144);
    await new Promise((r) => setTimeout(r, 2)); // distinct `at` timestamps
    const r160 = makeReport("10.9.9.1", "1.6.0", id);
    writeCapture(id, r160);

    const list = listCaptures(id);
    if (list.length !== 2) fail(`expected 2 captures, got ${list.length}`);
    if (list[0].verKey !== "1.6.0") fail("listCaptures should sort newest first");
    if (list[0].present !== 1 || list[0].absent !== 1) fail("capture verdict counts should reflect the report");

    if (resolveCapture(id, "1.4.4")?.verKey !== "1.4.4") fail("resolveCapture should exact-match by verKey");
    if (resolveCapture(id, "9.9.9") !== null) fail("resolveCapture should miss an unknown ver");
    if (newestCapture(id)?.verKey !== "1.6.0") fail("newestCapture should be the most recent");

    deleteCapture(id, "1.4.4");
    if (listCaptures(id).length !== 1) fail("deleteCapture should drop exactly the named capture");
    if (resolveCapture(id, "1.4.4") !== null) fail("deleted capture should no longer resolve");

    try {
      deleteCapture(id, "../etc/passwd");
      fail("deleteCapture should reject a path-unsafe verKey");
    } catch {
      /* expected */
    }

    rmSync(devicePaths(id).probesDir, { recursive: true, force: true });
  }

  // --- probeState: the §4.1 truth table (skip rows covered once P1 lands) ---
  {
    setDevicesFile({
      version: 1,
      active: null,
      devices: [
        { id: FAKE_IDS[0], label: "A", ip: "10.9.9.1", slots: {} },
        { id: FAKE_IDS[1], label: "B", ip: "10.9.9.2", slots: {} },
      ],
    });
    _resetCache();

    // known ver, no captures -> required, never-probed
    let state = probeState(FAKE_IDS[0]);
    if (!state.required || state.reason !== "never-probed") {
      fail(`known ver + no captures: ${JSON.stringify(state)}`);
    }

    // seed a capture for a *different* ver, then set device info to a newer one
    writeCapture(FAKE_IDS[0], makeReport("10.9.9.1", "1.4.4", FAKE_IDS[0]));
    setDevicesFile({
      version: 1,
      active: null,
      devices: [
        { id: FAKE_IDS[0], label: "A", ip: "10.9.9.1", info: { ver: "1.6.0" }, slots: {} },
        { id: FAKE_IDS[1], label: "B", ip: "10.9.9.2", slots: {} },
      ],
    });
    _resetCache();
    state = probeState(FAKE_IDS[0]);
    if (!state.required || state.reason !== "firmware-changed") {
      fail(`known ver + capture for a different ver: ${JSON.stringify(state)}`);
    }
    if (state.newest?.verKey !== "1.4.4") fail("firmware-changed state should surface the stale capture");

    // now the device's ver matches the capture -> satisfied
    setDevicesFile({
      version: 1,
      active: null,
      devices: [
        { id: FAKE_IDS[0], label: "A", ip: "10.9.9.1", info: { ver: "1.4.4" }, slots: {} },
        { id: FAKE_IDS[1], label: "B", ip: "10.9.9.2", slots: {} },
      ],
    });
    _resetCache();
    state = probeState(FAKE_IDS[0]);
    if (state.required || state.reason !== "none") fail(`known ver + matching capture: ${JSON.stringify(state)}`);
    if (state.matched?.verKey !== "1.4.4") fail("matched state should carry the exact-ver capture");

    // unknown ver (device never answered), but a capture exists -> satisfied
    state = probeState(FAKE_IDS[1]);
    if (!state.required || state.reason !== "never-probed") {
      fail(`unknown ver + no captures: ${JSON.stringify(state)}`);
    }
    writeCapture(FAKE_IDS[1], makeReport("10.9.9.2", "3.0.0", FAKE_IDS[1]));
    state = probeState(FAKE_IDS[1]);
    if (state.required || state.reason !== "none") {
      fail(`unknown ver + any capture should satisfy the gate: ${JSON.stringify(state)}`);
    }

    rmSync(devicePaths(FAKE_IDS[0]).probesDir, { recursive: true, force: true });
    rmSync(devicePaths(FAKE_IDS[1]).probesDir, { recursive: true, force: true });
  }

  // --- probeState: a valid skip suppresses `required`, and expires the
  // instant `ver` moves on (M16 §2.4) ---
  {
    setDevicesFile({
      version: 1,
      active: null,
      devices: [{ id: FAKE_IDS[0], label: "A", ip: "10.9.9.1", info: { ver: "1.4.4" }, slots: {} }],
    });
    _resetCache();

    let state = probeState(FAKE_IDS[0]);
    if (!state.required) fail("no skip, no capture: probe should still be required");

    setProbeSkip(FAKE_IDS[0], "1.4.4");
    state = probeState(FAKE_IDS[0]);
    if (state.required) fail("a skip for the current ver should suppress `required`");
    if (state.reason !== "never-probed") fail("skip must keep the underlying reason for display");
    if (!state.skipped || state.skipped.ver !== "1.4.4") fail("probeState should surface the skip record");

    // The device moves to a new firmware — the skip is for 1.4.4, not 1.6.0.
    setDevicesFile({
      version: 1,
      active: null,
      devices: [
        {
          id: FAKE_IDS[0],
          label: "A",
          ip: "10.9.9.1",
          info: { ver: "1.6.0" },
          slots: {},
          probeSkipped: { ver: "1.4.4", at: new Date().toISOString() },
        },
      ],
    });
    _resetCache();
    state = probeState(FAKE_IDS[0]);
    if (!state.required) fail("a skip for a stale ver must not suppress the new ver's requirement");
    if (state.skipped) fail("probeState must not surface a skip for a ver that no longer applies");

    // A successful probe for the skipped ver clears the record.
    setDevicesFile({
      version: 1,
      active: null,
      devices: [
        {
          id: FAKE_IDS[0],
          label: "A",
          ip: "10.9.9.1",
          info: { ver: "1.4.4" },
          slots: {},
          probeSkipped: { ver: "1.4.4", at: new Date().toISOString() },
        },
      ],
    });
    _resetCache();
    clearProbeSkip(FAKE_IDS[0], "1.4.4");
    const file = JSON.parse(readFileSync(DEVICES_FILE, "utf8"));
    if (file.devices[0].probeSkipped) fail("clearProbeSkip should drop the record once the ver matches");
  }

  // --- mirrorActiveDevice: exact-ver capture wins over newest ---
  {
    setDevicesFile({ version: 1, active: null, devices: [] });
    _resetCache();
    const device = await addDevice(
      { ip: "10.9.9.5", label: "Mirror test" },
      fakeRpcFactory({ id: FAKE_IDS[0], model: "M", gen: 2, ver: "1.6.0" }),
    );
    // addDevice used the probed id, which is not one of our fake ids — clean
    // it up under its real id too.
    writeCapture(device.id, makeReport(device.ip, "1.4.4", device.id));
    await new Promise((r) => setTimeout(r, 2));
    writeCapture(device.id, makeReport(device.ip, "1.6.0", device.id));

    setActive({ device: device.id, slot: 1, script: "main" });
    let mirrored = JSON.parse(readFileSync(PROBE_PATH, "utf8"));
    if (mirrored.ver !== "1.6.0") fail(`mirror should pick the exact-ver capture, got ${JSON.stringify(mirrored.ver)}`);

    deleteCapture(device.id, "1.6.0");
    mirrorActiveDevice(device.id);
    mirrored = JSON.parse(readFileSync(PROBE_PATH, "utf8"));
    if (mirrored.ver !== "1.4.4") fail(`mirror should fall back to the newest remaining capture, got ${JSON.stringify(mirrored.ver)}`);

    deleteCapture(device.id, "1.4.4");
    mirrorActiveDevice(device.id);
    mirrored = JSON.parse(readFileSync(PROBE_PATH, "utf8"));
    if (mirrored.ver !== "1.4.4") {
      fail("mirror should leave the previous mirror standing once every capture is gone, not blank it");
    }

    rmSync(join(DEVICES_DIR, "devices", device.id), { recursive: true, force: true });
  }

  console.log("OK: probe-store verKey/migration/CRUD/probeState/mirrorActiveDevice firmware fallback");
} finally {
  restore();
}
