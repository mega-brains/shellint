/**
 * device-scripts.ts slot operations against a fake RPC: Script.List mapping,
 * paged Script.GetCode reassembly, createSlot/deleteSlot ordering, and
 * deploy-to-new-slot creating exactly one slot end-to-end through deploy.ts's
 * injectable rpcFactory.
 * Usage: node --import tsx scripts/test-device-scripts.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, DIST_DIR, DEVICE_PROFILE_PATH, PROBE_PATH } from "../server/core/paths.ts";
import {
  createSlot,
  deleteSlot,
  getSlotCode,
  listSlots,
  rawList,
} from "../server/device/device-scripts.ts";
import { _resetCache, addDevice, loadDevices, setActive } from "../server/device/devices.ts";
import { deploy } from "../server/device/deploy.ts";
import { GENERATED_DTS_PATH } from "../server/probe/probe-typings.ts";

const DEVROOM_JSON = join(ROOT, "devroom.json");
const DEVICES_DIR = join(ROOT, ".devroom");
const DEVICES_FILE = join(DEVICES_DIR, "devices.json");
const ARTIFACT = join(DIST_DIR, "prod.js");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const originalDevroom = existsSync(DEVROOM_JSON) ? readFileSync(DEVROOM_JSON, "utf8") : null;
const originalDevices = existsSync(DEVICES_FILE) ? readFileSync(DEVICES_FILE, "utf8") : null;
const originalArtifact = existsSync(ARTIFACT) ? readFileSync(ARTIFACT) : null;
// setActive() re-mirrors these fixed paths for whichever device is active —
// this test activates a throwaway device with no cache, which wipes them.
const originalProfileMirror = existsSync(DEVICE_PROFILE_PATH)
  ? readFileSync(DEVICE_PROFILE_PATH, "utf8")
  : null;
const originalProbeMirror = existsSync(PROBE_PATH) ? readFileSync(PROBE_PATH, "utf8") : null;
const originalGeneratedDts = existsSync(GENERATED_DTS_PATH)
  ? readFileSync(GENERATED_DTS_PATH, "utf8")
  : null;

function restore() {
  if (originalDevroom !== null) writeFileSync(DEVROOM_JSON, originalDevroom, "utf8");
  if (originalDevices !== null) {
    mkdirSync(DEVICES_DIR, { recursive: true });
    writeFileSync(DEVICES_FILE, originalDevices, "utf8");
  } else {
    rmSync(DEVICES_FILE, { force: true });
  }
  if (originalArtifact !== null) {
    mkdirSync(DIST_DIR, { recursive: true });
    writeFileSync(ARTIFACT, originalArtifact);
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
  _resetCache();
}

/** Records calls in order so tests can assert on sequencing (e.g. stop-before-delete). */
function fakeSlotRpc(script) {
  const calls = [];
  return {
    calls,
    async call(method, params) {
      calls.push({ method, params });
      return script(method, params, calls);
    },
  };
}

try {
  // --- Script.List mapping (+ per-slot Script.GetStatus, best-effort) ---
  {
    const rpc = fakeSlotRpc((method, params) => {
      if (method === "Script.List") {
        return {
          scripts: [
            { id: 1, name: "devroom", enable: true },
            { id: 2, name: "other", enable: false },
          ],
        };
      }
      if (method === "Script.GetStatus") {
        if (params.id === 1) return { running: true, mem_used: 4096 };
        throw new Error("status unavailable"); // best-effort: slot 2 still listed
      }
      return null;
    });
    const device = { slots: { 1: { script: "main" } } };
    const slots = await listSlots(rpc, device);
    if (slots.length !== 2) fail(`expected 2 slots, got ${slots.length}`);
    if (slots[0].running !== true || slots[0].mem_used !== 4096) {
      fail(`expected slot 1 running with mem_used, got ${JSON.stringify(slots[0])}`);
    }
    if (slots[0].boundScript !== "main") fail("expected slot 1 boundScript from device.slots");
    if (slots[1].running !== null) {
      fail("expected slot 2's running to be null when Script.GetStatus fails");
    }
    if (slots[1].boundScript !== undefined) fail("slot 2 has no binding — boundScript should be undefined");

    const raw = await rawList(rpc);
    if (raw.length !== 2 || raw[1].name !== "other") fail("rawList should mirror Script.List");
  }

  // --- Script.GetCode paged reassembly (left>0 loop) ---
  {
    const pages = ["Shelly.", "addStatus", "Handler();"];
    let i = 0;
    const rpc = fakeSlotRpc((method) => {
      if (method !== "Script.GetCode") throw new Error(`unexpected ${method}`);
      const data = pages[i] ?? "";
      i += 1;
      const left = pages.length - i > 0 ? 1 : 0;
      return { data, left };
    });
    const code = await getSlotCode(rpc, 1);
    if (code !== pages.join("")) fail(`expected reassembled code "${pages.join("")}", got "${code}"`);
    if (i !== pages.length) fail(`expected ${pages.length} pages fetched, got ${i}`);
  }

  // --- createSlot returns the new id ---
  {
    const rpc = fakeSlotRpc((method) => {
      if (method === "Script.Create") return { id: 7 };
      throw new Error("unexpected call");
    });
    const id = await createSlot(rpc, "presence");
    if (id !== 7) fail(`expected createSlot to return 7, got ${id}`);
  }

  // --- deleteSlot: Stop before Delete, and Delete still runs if Stop throws ---
  {
    const rpc = fakeSlotRpc((method) => {
      if (method === "Script.Stop") throw new Error("already stopped");
      if (method === "Script.Delete") return {};
      throw new Error("unexpected call");
    });
    await deleteSlot(rpc, 3);
    if (rpc.calls.length !== 2) fail(`expected Stop then Delete (2 calls), got ${rpc.calls.length}`);
    if (rpc.calls[0].method !== "Script.Stop" || rpc.calls[1].method !== "Script.Delete") {
      fail(`expected [Stop, Delete], got ${JSON.stringify(rpc.calls.map((c) => c.method))}`);
    }
  }

  // --- deploy-to-new-slot creates exactly one slot ---
  {
    mkdirSync(DIST_DIR, { recursive: true });
    writeFileSync(ARTIFACT, "// test artifact\n", "utf8");

    mkdirSync(DEVICES_DIR, { recursive: true });
    writeFileSync(DEVICES_FILE, JSON.stringify({ version: 1, active: null, devices: [] }), "utf8");
    writeFileSync(DEVROOM_JSON, "{}", "utf8");
    _resetCache();
    const device = await addDevice({ ip: "10.0.2.1", label: "Bench" }, () => ({
      async connect() {
        throw new Error("offline (test)");
      },
      async call() {
        return {};
      },
      close() {},
    }));
    await setActive({ device: device.id, slot: 1, script: "main" });

    let createCalls = 0;
    const fakeDeployRpc = () => ({
      async connect() {},
      async call(method, params) {
        if (method === "Script.Create") {
          createCalls += 1;
          return { id: 42 };
        }
        if (method === "Script.PutCode") return { len: params.code.length };
        return {};
      },
      close() {},
    });

    const result = await deploy(
      "prod",
      () => {},
      "min",
      // This test is about slot creation, not the probe-required gate (M16
      // §2.3) — the fake device here was never probed.
      { createName: "presence", rpcFactory: fakeDeployRpc, skipProbeCheck: true },
    );
    if (createCalls !== 1) fail(`expected exactly one Script.Create call, got ${createCalls}`);
    if (result.scriptId !== 42) fail(`expected deploy to target the new slot 42, got ${result.scriptId}`);

    const bound = (await loadDevices()).devices.find((d) => d.id === device.id)?.slots["42"];
    if (!bound || bound.script !== "main" || bound.name !== "presence") {
      fail(`expected slot 42 bound to {script:"main",name:"presence"}, got ${JSON.stringify(bound)}`);
    }
  }

  console.log("OK: device-scripts slot list/code/create/delete, deploy-to-new-slot");
} finally {
  restore();
}
