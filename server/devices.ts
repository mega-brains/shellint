import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { ROOT, DEVICE_PROFILE_PATH, PROBE_PATH, devicePaths } from "./paths.ts";
import { AuthFailedError, ShellyRpc } from "./rpc.ts";
import { writeGeneratedTypings } from "./probe-typings.ts";

export type DeviceAuth = { username: string; password: string };
export type DeviceInfo = { model?: string; gen?: number; ver?: string; app?: string };
export type SlotBinding = { script: string; name?: string };
export type DeviceRecord = {
  id: string;
  label: string;
  ip: string;
  auth?: DeviceAuth;
  info?: DeviceInfo;
  lastSeen?: string;
  slots: Record<string, SlotBinding>;
};
export type ActiveSelection = { device: string; slot: number; script: string };
export type DevicesFile = {
  version: 1;
  active: ActiveSelection | null;
  devices: DeviceRecord[];
};
export type ActiveTarget = { device: DeviceRecord; slot: number; script: string };

const DEVICES_DIR = join(ROOT, ".devroom");
const DEVICES_FILE = join(DEVICES_DIR, "devices.json");

export class NoDeviceError extends Error {
  constructor() {
    super("no device selected — add one first");
    this.name = "NoDeviceError";
  }
}

export class DuplicateDeviceError extends Error {
  constructor(id: string) {
    super(`device "${id}" already exists`);
    this.name = "DuplicateDeviceError";
  }
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "device"
  );
}

function emptyFile(): DevicesFile {
  return { version: 1, active: null, devices: [] };
}

function ensureDir(): void {
  if (!existsSync(DEVICES_DIR)) mkdirSync(DEVICES_DIR, { recursive: true });
}

function readRaw(): DevicesFile | null {
  if (!existsSync(DEVICES_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(DEVICES_FILE, "utf8")) as Partial<DevicesFile>;
    if (!Array.isArray(parsed.devices)) return null;
    return { version: 1, active: parsed.active ?? null, devices: parsed.devices };
  } catch {
    return null;
  }
}

function writeRaw(file: DevicesFile): void {
  ensureDir();
  writeFileSync(DEVICES_FILE, JSON.stringify(file, null, 2) + "\n", "utf8");
  try {
    // Plaintext passwords live in here — keep it out of reach of other local users.
    chmodSync(DEVICES_FILE, 0o600);
  } catch {
    /* best-effort on platforms without POSIX chmod semantics */
  }
}

/**
 * One-way, automatic, idempotent migration from `devroom.json`'s legacy
 * single-device fields. Runs only when `devices.json` does not exist yet;
 * `devroom.json` itself is never rewritten, so it keeps working as the
 * fallback for as long as `devices.json` is absent.
 */
function migrateFromLegacyConfig(): DevicesFile {
  const file = emptyFile();
  const path = join(ROOT, "devroom.json");
  if (!existsSync(path)) return file;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return file;
  }

  const deviceIp = typeof raw.deviceIp === "string" ? raw.deviceIp : null;
  const deviceIp2 = typeof raw.deviceIp2 === "string" ? raw.deviceIp2 : null;
  const scriptId = typeof raw.scriptId === "number" ? raw.scriptId : 1;

  if (deviceIp) {
    const id = slug(deviceIp);
    const record: DeviceRecord = {
      id,
      label: "device",
      ip: deviceIp,
      slots: { [String(scriptId)]: { script: "main" } },
    };

    // Carry over the cached capability profile, if it is for this device —
    // keeps Tier 4 lint warm across the migration.
    if (existsSync(DEVICE_PROFILE_PATH)) {
      try {
        const profile = JSON.parse(readFileSync(DEVICE_PROFILE_PATH, "utf8")) as {
          deviceIp?: string;
        };
        if (profile.deviceIp === deviceIp) {
          const dir = join(DEVICES_DIR, "devices", id);
          mkdirSync(dir, { recursive: true });
          writeFileSync(
            join(dir, "profile.json"),
            readFileSync(DEVICE_PROFILE_PATH, "utf8"),
            "utf8",
          );
        }
      } catch {
        /* best-effort */
      }
    }

    file.devices.push(record);
    file.active = { device: id, slot: scriptId, script: "main" };
  }

  if (deviceIp2 && deviceIp2 !== deviceIp) {
    file.devices.push({ id: slug(deviceIp2), label: "device 2", ip: deviceIp2, slots: {} });
  }

  return file;
}

let cache: DevicesFile | null = null;

export function loadDevices(): DevicesFile {
  if (cache) return cache;
  const existing = readRaw();
  if (existing) {
    cache = existing;
    return cache;
  }
  const migrated = migrateFromLegacyConfig();
  cache = migrated;
  if (migrated.devices.length > 0) writeRaw(migrated);
  return cache;
}

function persist(file: DevicesFile): void {
  cache = file;
  writeRaw(file);
}

export function listDevices(): DeviceRecord[] {
  return loadDevices().devices;
}

export function getDevice(id: string): DeviceRecord | null {
  return loadDevices().devices.find((d) => d.id === id) ?? null;
}

/** Minimal RPC surface `addDevice` needs — lets tests supply a fake device. */
export type DeviceRpc = {
  connect(): Promise<void>;
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
};

export type DeviceRpcFactory = (ip: string, auth?: DeviceAuth) => DeviceRpc;

const defaultRpcFactory: DeviceRpcFactory = (ip, auth) => new ShellyRpc({ ip, auth });

async function probeDeviceInfo(rpc: DeviceRpc): Promise<DeviceInfo & { id?: string }> {
  await rpc.connect();
  const info = ((await rpc.call("Shelly.GetDeviceInfo", {})) ?? {}) as Record<
    string,
    unknown
  >;
  return {
    id: typeof info.id === "string" ? info.id : undefined,
    model: typeof info.model === "string" ? info.model : undefined,
    gen: typeof info.gen === "number" ? info.gen : undefined,
    ver: typeof info.ver === "string" ? info.ver : undefined,
    app: typeof info.app === "string" ? info.app : undefined,
  };
}

export type AddDeviceInput = { ip: string; label?: string; password?: string };

/**
 * Probes `Shelly.GetDeviceInfo` for a stable id + info. Offline (device
 * unreachable right now) falls back to `slug(label || ip)` — the id is
 * rewritten once on the first successful connect, since keying by IP goes
 * stale exactly when DHCP reassigns it. A wrong password (digest challenge
 * that fails) is rejected outright rather than stored to fail again later.
 * `rpcFactory` is a test seam — production always uses the real `ShellyRpc`.
 */
export async function addDevice(
  input: AddDeviceInput,
  rpcFactory: DeviceRpcFactory = defaultRpcFactory,
): Promise<DeviceRecord> {
  const file = loadDevices();
  if (file.devices.some((d) => d.ip === input.ip)) {
    throw new DuplicateDeviceError(input.ip);
  }
  const auth = input.password ? { username: "admin", password: input.password } : undefined;

  let id = slug(input.label || input.ip);
  let info: DeviceInfo | undefined;
  let lastSeen: string | undefined;
  const rpc = rpcFactory(input.ip, auth);
  try {
    const probed = await probeDeviceInfo(rpc);
    if (probed.id) id = probed.id;
    info = { model: probed.model, gen: probed.gen, ver: probed.ver, app: probed.app };
    lastSeen = new Date().toISOString();
  } catch (e) {
    if (e instanceof AuthFailedError) throw e;
    // Offline / unreachable right now — still add it with the fallback id.
  } finally {
    rpc.close();
  }

  if (file.devices.some((d) => d.id === id)) {
    throw new DuplicateDeviceError(id);
  }

  const record: DeviceRecord = {
    id,
    label: input.label || info?.model || input.ip,
    ip: input.ip,
    ...(auth ? { auth } : {}),
    ...(info ? { info } : {}),
    ...(lastSeen ? { lastSeen } : {}),
    slots: {},
  };
  persist({ ...file, devices: [...file.devices, record] });
  return record;
}

export type UpdateDeviceInput = { label?: string; ip?: string; password?: string | null };

export function updateDevice(id: string, patch: UpdateDeviceInput): DeviceRecord {
  const file = loadDevices();
  const idx = file.devices.findIndex((d) => d.id === id);
  if (idx === -1) throw new Error(`unknown device "${id}"`);
  const current = file.devices[idx]!;
  const next: DeviceRecord = { ...current };
  if (patch.label !== undefined) next.label = patch.label;
  if (patch.ip !== undefined) next.ip = patch.ip;
  if (patch.password === null) {
    delete next.auth;
  } else if (typeof patch.password === "string" && patch.password.length > 0) {
    next.auth = { username: next.auth?.username ?? "admin", password: patch.password };
  }
  const devices = [...file.devices];
  devices[idx] = next;
  persist({ ...file, devices });
  return next;
}

/** Clears `active` rather than leaving it dangling when it pointed at this device. */
export function removeDevice(id: string): void {
  const file = loadDevices();
  const devices = file.devices.filter((d) => d.id !== id);
  const active = file.active?.device === id ? null : file.active;
  persist({ ...file, devices, active });
}

export type SetActiveInput = { device?: string; slot?: number; script?: string };

export function setActive(input: SetActiveInput): ActiveTarget {
  const file = loadDevices();
  const deviceId = input.device ?? file.active?.device;
  if (!deviceId) throw new NoDeviceError();
  const device = file.devices.find((d) => d.id === deviceId);
  if (!device) throw new Error(`unknown device "${deviceId}"`);

  const slot = input.slot ?? file.active?.slot ?? 1;
  const script = input.script ?? file.active?.script ?? "main";
  const active: ActiveSelection = { device: deviceId, slot, script };
  persist({ ...file, active });
  mirrorActiveDevice(deviceId);
  return { device, slot, script };
}

/** Copies `src` to `dest` via a temp file + rename, so a crash mid-write never
 * leaves `dest` half-written. */
function atomicCopy(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, readFileSync(src));
  renameSync(tmp, dest);
}

/**
 * Rewrites `types/device-profile.json` / `types/generated-probe.json` /
 * `types/generated.d.ts` to mirror `deviceId`'s cached capability data —
 * the compile path (`tsconfig.shelly.json`, `build-shelly.mjs`) reads those
 * fixed paths unparameterized, so switching devices means swapping what they
 * point at rather than threading a device id through the whole pipeline.
 * Mirrors are written temp-then-rename; if that fails, the previous mirror
 * is left in place (never a half-written mix of two devices).
 */
export function mirrorActiveDevice(deviceId: string): void {
  const src = devicePaths(deviceId);
  if (existsSync(src.profile)) {
    atomicCopy(src.profile, DEVICE_PROFILE_PATH);
  } else {
    rmSync(DEVICE_PROFILE_PATH, { force: true });
  }
  if (existsSync(src.probe)) {
    atomicCopy(src.probe, PROBE_PATH);
  } else {
    rmSync(PROBE_PATH, { force: true });
  }
  writeGeneratedTypings();
}

/** Records which local script key a device slot holds — `Deploy` with a new slot writes this back. */
export function bindSlot(deviceId: string, slot: number, script: string, name?: string): void {
  const file = loadDevices();
  const idx = file.devices.findIndex((d) => d.id === deviceId);
  if (idx === -1) throw new Error(`unknown device "${deviceId}"`);
  const current = file.devices[idx]!;
  const slots = { ...current.slots, [String(slot)]: { script, ...(name ? { name } : {}) } };
  const devices = [...file.devices];
  devices[idx] = { ...current, slots };
  persist({ ...file, devices });
}

export function requireActive(): ActiveTarget {
  const file = loadDevices();
  if (!file.active) throw new NoDeviceError();
  const device = file.devices.find((d) => d.id === file.active!.device);
  if (!device) throw new NoDeviceError();
  return { device, slot: file.active.slot, script: file.active.script };
}

/** Every RPC call site resolves its target through here. */
export function resolveTarget(deviceId?: string): { ip: string; auth?: DeviceAuth } {
  const device = deviceId ? getDevice(deviceId) : requireActive().device;
  if (!device) throw new NoDeviceError();
  return { ip: device.ip, auth: device.auth };
}

/** Public view of a device — never serialize `auth.password` to a client. */
export function sanitizeDevice(d: DeviceRecord) {
  return {
    id: d.id,
    label: d.label,
    ip: d.ip,
    hasPassword: !!d.auth?.password,
    info: d.info,
    lastSeen: d.lastSeen,
    slots: d.slots,
  };
}

/** Test-only: drop the in-memory cache so a fresh `loadDevices()` re-reads disk. */
export function _resetCache(): void {
  cache = null;
}
