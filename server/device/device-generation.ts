import type { DeviceInfo } from "./devices.ts";

const HTTP_TIMEOUT_MS = 2500;
const MAX_BODY_BYTES = 16 * 1024;

export class UnsupportedDeviceError extends Error {
  gen: number | null;
  model: string | null;
  constructor(model: string | null, gen: number | null) {
    const subject = model ? `${model} is a Gen1 device` : "This device is Gen1";
    super(`${subject} — Gen1 hardware has no script runtime, so shellint cannot build, lint or deploy to it. shellint needs a Gen2, Gen3 or Gen4 device.`);
    this.name = "UnsupportedDeviceError";
    this.gen = gen;
    this.model = model;
  }
}

export type GenVerdict =
  | { kind: "gen2plus"; info: DeviceInfo & { id?: string } }
  | { kind: "gen1"; model: string | null }
  | { kind: "unknown" };

export type ShellyHttpFetch = (url: string, signal: AbortSignal) => Promise<Response>;

function deviceInfo(raw: Record<string, unknown>): DeviceInfo & { id?: string } {
  return {
    id: typeof raw.id === "string" ? raw.id : undefined,
    model: typeof raw.model === "string" ? raw.model : undefined,
    gen: typeof raw.gen === "number" ? raw.gen : undefined,
    ver: typeof raw.ver === "string" ? raw.ver : undefined,
    app: typeof raw.app === "string" ? raw.app : undefined,
  };
}

/** Positive Gen1 evidence needs both Gen1-only discriminants. */
export function classifyShellyBody(raw: unknown): GenVerdict {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { kind: "unknown" };
  const body = raw as Record<string, unknown>;
  if (typeof body.gen === "number") {
    return body.gen >= 2
      ? { kind: "gen2plus", info: deviceInfo(body) }
      : { kind: "gen1", model: typeof body.model === "string" ? body.model : typeof body.type === "string" ? body.type : null };
  }
  if ("gen" in body) return { kind: "unknown" };
  return typeof body.type === "string" && typeof body.fw === "string"
    ? { kind: "gen1", model: body.type }
    : { kind: "unknown" };
}

const defaultHttpFetch: ShellyHttpFetch = (url, signal) => fetch(url, { signal });

/** `/shelly` stays HTTP: slim txiki builds have no TLS support. */
export async function probeShellyHttp(
  ip: string,
  fetchImpl: ShellyHttpFetch = defaultHttpFetch,
): Promise<GenVerdict> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`http://${ip}/shelly`, controller.signal);
    const length = Number(res.headers.get("content-length"));
    if (!res.ok || (Number.isFinite(length) && length > MAX_BODY_BYTES)) return { kind: "unknown" };
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) return { kind: "unknown" };
    return classifyShellyBody(JSON.parse(text));
  } catch {
    return { kind: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}
