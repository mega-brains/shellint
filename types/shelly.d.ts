/**
 * Shelly Gen2+ in-script ambient globals.
 * Basics for DevRoom samples — not a full RPC dump.
 * Timer API: Timer.set / Timer.clear (not browser setTimeout).
 */

// ---------------------------------------------------------------------------
// console
// ---------------------------------------------------------------------------

interface Console {
  log(...data: unknown[]): void;
}

declare var console: Console;

/**
 * Espruino's own logger, confirmed present by `mise run probe`
 * (`typeof print` → "function"). Cheaper than `console.log`, which carries
 * ~42 B of overhead per call, so it is the right choice in hot paths.
 */
declare function print(...data: unknown[]): void;

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

type TimerCallback = (userdata?: unknown) => void;

interface TimerInfo {
  interval: number;
  next: number;
}

interface TimerStatic {
  /**
   * Schedule a timer. Max 5 per script. Practical min period ~10 ms.
   * @param period_ms delay / interval in milliseconds
   * @param repeat true = repeating; false = one-shot
   * @returns handle
   */
  set(
    period_ms: number,
    repeat: boolean,
    callback: TimerCallback,
    userdata?: unknown
  ): number;

  /** Clear a timer. Always clear before re-assigning a live handle. */
  clear(handle: number): boolean | undefined;

  getInfo(handle: number): TimerInfo | undefined;
}

declare var Timer: TimerStatic;

// ---------------------------------------------------------------------------
// Shelly
// ---------------------------------------------------------------------------

/** error_code === 0 means success. */
type ShellyCallCallback = (
  result: unknown,
  error_code: number,
  error_message: string,
  userdata?: unknown
) => void;

interface ShellyEventData {
  component: string;
  id: number;
  info: {
    event: string;
    ts?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ShellyStatusData {
  component: string;
  /** Only changed keys — check before reading nested fields. */
  delta: {
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

type ShellyEventHandler = (
  event_data: ShellyEventData,
  userdata?: unknown
) => void;

type ShellyStatusHandler = (
  status: ShellyStatusData,
  userdata?: unknown
) => void;

interface ShellyDeviceInfo {
  id?: string;
  mac?: string;
  model?: string;
  gen?: number;
  fw_id?: string;
  ver?: string;
  app?: string;
  [key: string]: unknown;
}

/**
 * @see {@link https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Shelly}
 */
interface ShellyStatic {
  /**
   * Async component call. Max 5 in flight.
   * Prefer getComponentStatus/Config for GetStatus/GetConfig.
   */
  call(
    method: string,
    params: object | null | undefined,
    callback?: ShellyCallCallback,
    userdata?: unknown
  ): undefined;

  addEventHandler(cb: ShellyEventHandler, userdata?: unknown): number;
  addStatusHandler(cb: ShellyStatusHandler, userdata?: unknown): number;
  removeEventHandler(handle: number): boolean | undefined;
  removeStatusHandler(handle: number): boolean | undefined;

  emitEvent(name: string, data: unknown): undefined;

  /** Synchronous. Accepts ("switch", 0) or ("switch:0"). */
  getComponentConfig(type_or_key: string, id?: number): object | null;

  /** Synchronous. Prefer over Shelly.call("*.GetStatus"). */
  getComponentStatus(type_or_key: string, id?: number): object | null;

  getDeviceInfo(): ShellyDeviceInfo;
  getCurrentScriptId(): number;
  getUptimeMs(): number;
}

declare var Shelly: ShellyStatic;

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

interface ScriptStorage {
  setItem(key: string, value: string): void;
  getItem(key: string): string | null;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
}

type ScriptRpcHandler = (
  request: {
    result: (value: unknown) => void;
    error: (code: number, message: string) => void;
  },
  params: unknown,
  userdata?: unknown
) => void;

/**
 * @see {@link https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Script}
 * @see {@link https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/RPCHandlers} for addRpcHandler
 */
interface ScriptStatic {
  readonly id: number;
  readonly storage: ScriptStorage;
  addRpcHandler(
    method: string,
    cb: ScriptRpcHandler,
    userdata?: unknown
  ): number;
  removeRpcHandler(handle: number): boolean;
  getVcHandle(role: string): unknown;
}

declare var Script: ScriptStatic;

// ---------------------------------------------------------------------------
// HTTPServer
// ---------------------------------------------------------------------------

/** Headers are `[name, value]` pairs on the device, not an object. */
type HttpHeaderPairs = Array<[string, string]>;

interface HttpServerRequest {
  method: string;
  query: string | null;
  headers: HttpHeaderPairs;
  body: string;
}

interface HttpServerResponse {
  code: number;
  body: string;
  headers: HttpHeaderPairs;
  /** Must be called, or the device answers 504 after 10 s. */
  send(): boolean;
}

/**
 * @see {@link https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/HTTPServer}
 */
interface HTTPServerStatic {
  /** Max 5 endpoints per script. */
  registerEndpoint(
    endpoint: string,
    handler: (
      request: HttpServerRequest,
      response: HttpServerResponse,
      userdata?: unknown
    ) => void,
    userdata?: unknown
  ): string;
}

declare var HTTPServer: HTTPServerStatic;

// ---------------------------------------------------------------------------
// Virtual components
// ---------------------------------------------------------------------------

interface VirtualComponentHandle {
  getValue(): unknown;
  setValue(value: unknown): void;
}

/**
 * @see {@link https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Virtual}
 */
interface VirtualStatic {
  /** `key` is `"<type>:<id>"`, e.g. `"number:200"`. */
  getHandle(key: string): VirtualComponentHandle;
}

declare var Virtual: VirtualStatic;

// ---------------------------------------------------------------------------
// BLE
// ---------------------------------------------------------------------------

interface BleScanResult {
  addr: string;
  address?: string;
  rssi: number;
  name?: string | null;
  /** Keyed by lowercase 4-hex manufacturer id, value is a raw byte string. */
  manufacturer_data?: { [manufacturerId: string]: string };
}

type BleScanCallback = (event: number, result: BleScanResult | null) => void;

interface BleScannerStatic {
  readonly SCAN_RESULT: number;
  readonly INFINITE_SCAN: number;
  Start(
    params: { duration_ms: number; filters?: { addrs?: string[] }[] },
    callback: BleScanCallback
  ): boolean;
}

interface BLEStatic {
  Scanner: BleScannerStatic;
}

declare var BLE: BLEStatic;

// ---------------------------------------------------------------------------
// AES
// ---------------------------------------------------------------------------

/**
 * @see {@link https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/AES}
 */
interface AESStatic {
  /** Returns null on failure. `mode` e.g. `"ECB"`. */
  encrypt(
    data: ArrayBuffer,
    key: ArrayBuffer,
    options: { mode: string }
  ): ArrayBuffer | null;
}

declare var AES: AESStatic;
