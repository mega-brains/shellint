/**
 * Probe-required deploy gate (M16 §2.3): a device active with no matching
 * capture must refuse Deploy over HTTP (409, code: "probe-required") and at
 * the `deploy()` function level (`ProbeRequiredError`); a skip must lift it;
 * `skipProbeCheck` must bypass it entirely. Split out of test-smoke.mjs to
 * stay under the 500-line cap. Touches the real `.devroom/devices.json`, so
 * it is backed up and restored, scoped to one fake device.
 * Usage: node --import tsx scripts/test-deploy-gate.mjs
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../server/core/paths.ts";
import { _resetCache, addDevice, setActive } from "../server/device/devices.ts";
import { deploy, ProbeRequiredError } from "../server/device/deploy.ts";
import { createApp } from "../server/app.ts";

const DEVICES_DIR = join(ROOT, ".devroom");
const DEVICES_FILE = join(DEVICES_DIR, "devices.json");
const originalDevices = existsSync(DEVICES_FILE) ? readFileSync(DEVICES_FILE, "utf8") : null;

function restore() {
  if (originalDevices !== null) {
    writeFileSync(DEVICES_FILE, originalDevices, "utf8");
  } else {
    rmSync(DEVICES_FILE, { force: true });
  }
  _resetCache();
}

const fakeRpcFactory = () => ({
  async connect() {},
  async call() {
    return { len: 1 };
  },
  close() {},
});

const offlineRpcFactory = () => ({
  async connect() {
    throw new Error("offline (test)");
  },
  async call() {
    return {};
  },
  close() {},
});

try {
  writeFileSync(DEVICES_FILE, JSON.stringify({ version: 1, active: null, devices: [] }), "utf8");
  _resetCache();
  const gated = await addDevice({ ip: "10.0.9.9", label: "Gate test" }, offlineRpcFactory);
  await setActive({ device: gated.id, slot: 1, script: "main" });

  const app = createApp();
  const deployRes = await app.request("/api/deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "debug", minify: "min" }),
  });
  if (deployRes.status !== 409) {
    throw new Error("expected 409 from a probe-required deploy, got " + deployRes.status);
  }
  const deployBody = await deployRes.json();
  if (deployBody.code !== "probe-required") {
    throw new Error("expected code: probe-required, got " + JSON.stringify(deployBody));
  }

  // Same refusal at the function level, as `ProbeRequiredError` — this is
  // what `deviceError()` maps onto the 409 above.
  try {
    await deploy("debug", () => {}, "min", { deviceId: gated.id, rpcFactory: fakeRpcFactory });
    throw new Error("deploy() should refuse a probe-required device");
  } catch (e) {
    if (!(e instanceof ProbeRequiredError)) throw e;
  }

  // skipProbeCheck bypasses the gate entirely — the CLI's --no-probe-check path.
  const bypassed = await deploy("debug", () => {}, "min", {
    deviceId: gated.id,
    skipProbeCheck: true,
    rpcFactory: fakeRpcFactory,
  });
  if (bypassed.status !== "running") throw new Error("skipProbeCheck should let deploy() proceed");

  // A skip via the API lifts the gate for the plain (non-bypassed) path too.
  const skipRes = await app.request("/api/probe/skip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device: gated.id }),
  });
  const skipBody = await skipRes.json();
  if (skipBody.required) throw new Error("POST /api/probe/skip should clear `required`");

  const afterSkip = await deploy("debug", () => {}, "min", {
    deviceId: gated.id,
    rpcFactory: fakeRpcFactory,
  });
  if (afterSkip.status !== "running") throw new Error("a valid skip should let an ungated deploy() proceed");

  rmSync(join(DEVICES_DIR, "devices", gated.id), { recursive: true, force: true });
  console.log("OK: deploy gate refuses/skips/bypasses on a probe-required device");
} finally {
  restore();
}
