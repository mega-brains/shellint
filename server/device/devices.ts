import { runtime } from "#shellint/runtime";
import { DEVICE_PROFILE_PATH, PROBE_PATH, STATE_DIR, devicePaths } from "../core/paths.ts";
import { AuthFailedError } from "./rpc.ts";
import { pooledRpc } from "./rpc-pool.ts";
import { probeShellyHttp, UnsupportedDeviceError, type ShellyHttpFetch } from "./device-generation.ts";
import { writeGeneratedTypings } from "../probe/probe-typings.ts";
import { newestCapture, probeState, resolveCapture, type ProbeSkip } from "../probe/probe-store.ts";
import { resolveConfigPath } from "../core/config.ts";
import { migrateStateDir } from "../core/migrate-state-dir.ts";

const { fs } = runtime;
const { dirname, join } = runtime.path;
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
  /** One slot, not a list — a skip for an older firmware is dead the moment
   * `ver` moves (M16 §3.3). */
  probeSkipped?: ProbeSkip;
  unsupported?: { gen: number | null; model: string | null; at: string };
};
export type ActiveSelection = { device: string; slot: number; script: string };
export type DevicesFile = {
  version: 1;
  active: ActiveSelection | null;
  devices: DeviceRecord[];
};
export type ActiveTarget = { device: DeviceRecord; slot: number; script: string };
const DEVICES_FILE = join(STATE_DIR, "devices.json");
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
async function readRaw(): Promise<DevicesFile | null> {
  if (!(await fs.exists(DEVICES_FILE))) return null;
  try {
    const parsed = JSON.parse(await fs.readText(DEVICES_FILE)) as Partial<DevicesFile>;
    if (!Array.isArray(parsed.devices)) return null;
    return { version: 1, active: parsed.active ?? null, devices: parsed.devices };
  } catch {
    return null;
  }
}

let writeQueue = Promise.resolve();

function writeRaw(file: DevicesFile): Promise<void> {
  const write = writeQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(STATE_DIR, { recursive: true });
    await fs.atomicWriteText(DEVICES_FILE, JSON.stringify(file, null, 2) + "\n", {
      mode: 0o600,
    });
  });
  writeQueue = write;
  return write;
}

/**
 * Seeds a per-device cache file from a legacy top-level `types/` capture, but
 * only when that capture names the device being migrated — an unrelated
 * device's profile would poison Tier 4 lint.
 */
async function adoptForDevice(src: string, dest: string, deviceIp: string): Promise<void> {
  if (!(await fs.exists(src))) return;
  try {
    const text = await fs.readText(src);
    const parsed = JSON.parse(text) as { deviceIp?: string };
    if (parsed.deviceIp !== deviceIp) return;
    await fs.mkdir(dirname(dest), { recursive: true });
    await fs.writeText(dest, text);
  } catch {
    /* best-effort — a corrupt capture just means a cold cache */
  }
}

/**
 * One-way, automatic, idempotent migration from legacy config fields.
 * single-device fields. Runs only when `devices.json` does not exist yet;
 * Config selection follows core/config.ts. Files never get rewritten here.
 */
async function migrateFromLegacyConfig(): Promise<DevicesFile> {
  const file = emptyFile();
  const path = await resolveConfigPath();
  if (!path) return file;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await fs.readText(path)) as Record<string, unknown>;
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

    const dest = devicePaths(id);
    await adoptForDevice(DEVICE_PROFILE_PATH, dest.profile, deviceIp);
    await adoptForDevice(PROBE_PATH, dest.probe, deviceIp);

    file.devices.push(record);
    file.active = { device: id, slot: scriptId, script: "main" };
  }

  if (deviceIp2 && deviceIp2 !== deviceIp) {
    file.devices.push({ id: slug(deviceIp2), label: "device 2", ip: deviceIp2, slots: {} });
  }

  return file;
}

let cache: DevicesFile | null = null;
let loading: Promise<DevicesFile> | null = null;

export async function loadDevices(): Promise<DevicesFile> {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    // Every server and CLI path that touches a device comes through here.
    await migrateStateDir();
    const existing = await readRaw();
    if (existing) return existing;
    const migrated = await migrateFromLegacyConfig();
    if (migrated.devices.length > 0) await writeRaw(migrated);
    return migrated;
  })();
  try {
    cache = await loading;
    return cache;
  } finally {
    loading = null;
  }
}

async function persist(file: DevicesFile): Promise<void> {
  const previous = cache;
  cache = file;
  try {
    await writeRaw(file);
  } catch (error) {
    if (cache === file) cache = previous;
    throw error;
  }
}

export async function listDevices(): Promise<DeviceRecord[]> {
  return (await loadDevices()).devices;
}

export async function getDevice(id: string): Promise<DeviceRecord | null> {
  return (await loadDevices()).devices.find((d) => d.id === id) ?? null;
}

/** Minimal RPC surface `addDevice` needs — lets tests supply a fake device. */
export type DeviceRpc = {
  connect(): Promise<void>;
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
};

export type DeviceRpcFactory = (ip: string, auth?: DeviceAuth) => DeviceRpc;

const defaultRpcFactory: DeviceRpcFactory = (ip, auth) => pooledRpc({ ip, auth });

/** Narrows a raw `Shelly.GetDeviceInfo` answer down to the fields we cache. */
export function toDeviceInfo(raw: Record<string, unknown>): DeviceInfo {
  return { model: typeof raw.model === "string" ? raw.model : undefined, gen: typeof raw.gen === "number" ? raw.gen : undefined, ver: typeof raw.ver === "string" ? raw.ver : undefined, app: typeof raw.app === "string" ? raw.app : undefined };
}

/** Persists changed `GetDeviceInfo` fields without rewriting unchanged status polls. */
export async function touchDeviceInfo(id: string, info: DeviceInfo): Promise<void> {
  const file = await loadDevices();
  const idx = file.devices.findIndex((d) => d.id === id);
  if (idx === -1) return;
  const current = file.devices[idx]!.info;
  const changed =
    current?.model !== info.model ||
    current?.gen !== info.gen ||
    current?.ver !== info.ver ||
    current?.app !== info.app;
  if (!changed) return;
  const devices = [...file.devices];
  devices[idx] = { ...devices[idx]!, info, lastSeen: new Date().toISOString() };
  await persist({ ...file, devices });
}

async function probeDeviceInfo(rpc: DeviceRpc): Promise<DeviceInfo & { id?: string }> {
  await rpc.connect();
  const info = ((await rpc.call("Shelly.GetDeviceInfo", {})) ?? {}) as Record<string, unknown>;
  return {
    id: typeof info.id === "string" ? info.id : undefined,
    ...toDeviceInfo(info),
  };
}

async function fallbackDeviceInfo(ip: string, httpFetch?: ShellyHttpFetch) {
  const verdict = await probeShellyHttp(ip, httpFetch);
  if (verdict.kind === "gen1") throw new UnsupportedDeviceError(verdict.model, null);
  return verdict.kind === "gen2plus" ? verdict.info : null;
}

function assertSupported(info: DeviceInfo): void {
  if (info.gen != null && info.gen < 2) throw new UnsupportedDeviceError(info.model ?? null, info.gen);
}

export type AddDeviceInput = { ip: string; label?: string; password?: string };

/** Adds offline devices too; id stays safe for `.shellint/devices/<id>/` paths. */
export async function addDevice(
  input: AddDeviceInput,
  rpcFactory: DeviceRpcFactory = defaultRpcFactory,
  httpFetch?: ShellyHttpFetch,
): Promise<DeviceRecord> {
  const file = await loadDevices();
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
    assertSupported(probed);
    if (probed.id) id = slug(probed.id);
    info = { model: probed.model, gen: probed.gen, ver: probed.ver, app: probed.app };
    lastSeen = new Date().toISOString();
  } catch (e) {
    if (e instanceof AuthFailedError) throw e;
    if (e instanceof UnsupportedDeviceError) throw e;
    const fallback = await fallbackDeviceInfo(input.ip, httpFetch);
    if (fallback) {
      id = fallback.id ? slug(fallback.id) : id;
      info = fallback;
      lastSeen = new Date().toISOString();
    }
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
  await persist({ ...file, devices: [...file.devices, record] });
  return record;
}

export type UpdateDeviceInput = { label?: string; ip?: string; password?: string | null };

export async function updateDevice(id: string, patch: UpdateDeviceInput): Promise<DeviceRecord> {
  const file = await loadDevices();
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
  await persist({ ...file, devices });
  return next;
}

/** Clears `active` rather than leaving it dangling when it pointed at this device. */
export async function removeDevice(id: string): Promise<void> {
  const file = await loadDevices();
  const devices = file.devices.filter((d) => d.id !== id);
  const active = file.active?.device === id ? null : file.active;
  await persist({ ...file, devices, active });
}

export type SetActiveInput = { device?: string; slot?: number; script?: string };

export async function setActive(input: SetActiveInput): Promise<ActiveTarget> {
  const file = await loadDevices();
  const deviceId = input.device ?? file.active?.device;
  if (!deviceId) throw new NoDeviceError();
  const device = file.devices.find((d) => d.id === deviceId);
  if (!device) throw new Error(`unknown device "${deviceId}"`);

  const slot = input.slot ?? file.active?.slot ?? 1;
  const script = input.script ?? file.active?.script ?? "main";
  const active: ActiveSelection = { device: deviceId, slot, script };
  await persist({ ...file, active });
  await mirrorActiveDevice(deviceId);
  return { device, slot, script };
}

/** Copies `src` to `dest` via a temp file + rename, so a crash mid-write never
 * leaves `dest` half-written. */
async function atomicCopy(src: string, dest: string): Promise<void> {
  await fs.mkdir(dirname(dest), { recursive: true });
  await fs.atomicWriteText(dest, await fs.readText(src));
}

/**
 * Rewrites `types/device-profile.json` / `types/generated-probe.json` /
 * `types/generated.d.ts` to mirror `deviceId`'s cached capability data —
 * the compile path (`config/tsconfig.shelly.base.json`, `build-shelly.mjs`) reads those
 * fixed paths unparameterized, so switching devices means swapping what they
 * point at rather than threading a device id through the whole pipeline.
 * Mirrors are written temp-then-rename; if that fails, the previous mirror
 * is left in place (never a half-written mix of two devices).
 *
 * A device with no cache of its own (never connected, never probed) leaves the
 * previous mirror standing rather than deleting it: blanking it would destroy
 * a real capture to say nothing, and both files name their source device
 * (`deviceIp`, echoed into the `generated.d.ts` header), so a stale mirror is
 * self-identifying. It refreshes as soon as that device answers.
 *
 * The probe half picks the capture for the device's *current* firmware when
 * one exists, falling back to the newest capture on file, falling back to the
 * legacy single-capture `probe.json` (M16 §4.2) — never all three absent at
 * once falls through to "leave the previous mirror standing" above.
 */
export async function mirrorActiveDevice(deviceId: string): Promise<void> {
  const src = devicePaths(deviceId);
  let changed = false;
  if (await fs.exists(src.profile)) {
    await atomicCopy(src.profile, DEVICE_PROFILE_PATH);
    changed = true;
  }
  const device = await getDevice(deviceId);
  const capture =
    (await resolveCapture(deviceId, device?.info?.ver)) ?? (await newestCapture(deviceId));
  const probeSrc = capture?.path ?? ((await fs.exists(src.probe)) ? src.probe : null);
  if (probeSrc) {
    await atomicCopy(probeSrc, PROBE_PATH);
    changed = true;
  }
  if (changed) await writeGeneratedTypings();
}

/** Records which local script key a device slot holds — `Deploy` with a new slot writes this back. */
export async function bindSlot(
  deviceId: string,
  slot: number,
  script: string,
  name?: string,
): Promise<void> {
  const file = await loadDevices();
  const idx = file.devices.findIndex((d) => d.id === deviceId);
  if (idx === -1) throw new Error(`unknown device "${deviceId}"`);
  const current = file.devices[idx]!;
  const slots = { ...current.slots, [String(slot)]: { script, ...(name ? { name } : {}) } };
  const devices = [...file.devices];
  devices[idx] = { ...current, slots };
  await persist({ ...file, devices });
}

export async function requireActive(): Promise<ActiveTarget> {
  const file = await loadDevices();
  if (!file.active) throw new NoDeviceError();
  const device = file.devices.find((d) => d.id === file.active!.device);
  if (!device) throw new NoDeviceError();
  return { device, slot: file.active.slot, script: file.active.script };
}

export type ActiveIdentity = { id: string; ip: string; ver: string | null };
/**
 * Identity of the active device, or null when none is configured. Never
 * throws: the lint pass asks this offline, where "no device yet" is a normal
 * state. `ver` is `device.info?.ver` — refreshed by `touchDeviceInfo`, not
 * necessarily current the instant firmware changes underneath it.
 */
export async function activeDeviceIdentity(): Promise<ActiveIdentity | null> {
  try {
    const { device } = await requireActive();
    return { id: device.id, ip: device.ip, ver: device.info?.ver ?? null };
  } catch {
    return null;
  }
}

/** Every RPC call site resolves its target through here. */
export async function resolveTarget(
  deviceId?: string,
): Promise<{ ip: string; auth?: DeviceAuth }> {
  const device = deviceId ? await getDevice(deviceId) : (await requireActive()).device;
  if (!device) throw new NoDeviceError();
  return { ip: device.ip, auth: device.auth };
}

/**
 * Records (or refreshes) a skip for the device's *current* firmware — one
 * slot, not a list, since a skip for an older `ver` is dead the moment `ver`
 * moves (M16 §3.3). `ver: null` covers the device-never-answered case, where
 * the skip is exactly what unblocks an unreachable box.
 */
export async function setProbeSkip(id: string, ver: string | null): Promise<ProbeSkip> {
  const file = await loadDevices();
  const idx = file.devices.findIndex((d) => d.id === id);
  if (idx === -1) throw new Error(`unknown device "${id}"`);
  const skip: ProbeSkip = { ver, at: new Date().toISOString() };
  const devices = [...file.devices];
  devices[idx] = { ...devices[idx]!, probeSkipped: skip };
  await persist({ ...file, devices });
  return skip;
}

/** Called once a probe succeeds for `ver` — a skip for that same `ver` is now moot. */
export async function clearProbeSkip(id: string, ver: string | null): Promise<void> {
  const file = await loadDevices();
  const idx = file.devices.findIndex((d) => d.id === id);
  if (idx === -1) return;
  const current = file.devices[idx]!;
  if (!current.probeSkipped || current.probeSkipped.ver !== ver) return;
  const { probeSkipped: _drop, ...rest } = current;
  const devices = [...file.devices];
  devices[idx] = rest;
  await persist({ ...file, devices });
}

export async function markUnsupportedDevice(id: string, model: string | null, gen: number | null): Promise<DeviceRecord | null> {
  const file = await loadDevices();
  const idx = file.devices.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  const devices = [...file.devices];
  const record = { ...devices[idx]!, unsupported: { model, gen, at: new Date().toISOString() } };
  devices[idx] = record;
  await persist({ ...file, devices });
  return record;
}
/** Public view of a device — never serialize `auth.password` to a client. */
export async function sanitizeDevice(d: DeviceRecord) {
  const state = await probeState(d.id);
  return {
    id: d.id,
    label: d.label,
    ip: d.ip,
    hasPassword: !!d.auth?.password,
    info: d.info,
    lastSeen: d.lastSeen,
    unsupported: d.unsupported,
    slots: d.slots,
    probe: {
      required: state.required,
      reason: state.reason,
      ver: state.ver,
      at: (state.matched ?? state.newest)?.at ?? null,
    },
  };
}

export function _resetCache(): void {
  cache = null; loading = null;
}
