/**
 * GENERATED FILE — do not edit by hand. Regenerate with `mise run probe`.
 * Source: types/generated-probe.json (192.168.3.106 fw 2.0.0, probed 2026-08-17T08:18:36.972Z).
 *
 * ADVISORY ONLY. It is not part of the device compile and does not stand in
 * for types/espruino-lib.d.ts: every declaration sits inside one namespace,
 * so this file adds no global and changes no typecheck. It records the
 * surface the probe confirmed present; the confirmed-absent half is reported
 * by the `probe-absent-api` lint check instead.
 */

declare namespace ProbedDevice {
  namespace array {
    /** `typeof [].map` → "function" */
    const map: (...args: unknown[]) => unknown;
    /** `typeof [].forEach` → "function" */
    const forEach: (...args: unknown[]) => unknown;
    /** `typeof [].filter` → "function" */
    const filter: (...args: unknown[]) => unknown;
    /** `typeof [].some` → "function" */
    const some: (...args: unknown[]) => unknown;
    /** `typeof [].every` → "function" */
    const every: (...args: unknown[]) => unknown;
    /** `typeof [].indexOf` → "function" */
    const indexOf: (...args: unknown[]) => unknown;
    /** `typeof [].join` → "function" */
    const join: (...args: unknown[]) => unknown;
    /** `typeof [].push` → "function" */
    const push: (...args: unknown[]) => unknown;
    /** `typeof [].pop` → "function" */
    const pop: (...args: unknown[]) => unknown;
    /** `typeof [].splice` → "function" */
    const splice: (...args: unknown[]) => unknown;
    /** `typeof [].slice` → "function" */
    const slice: (...args: unknown[]) => unknown;
  }
  namespace Array {
    /** `typeof Array.isArray` → "function" */
    const isArray: (...args: unknown[]) => unknown;
  }
  namespace string {
    /** `typeof "".charAt` → "function" */
    const charAt: (...args: unknown[]) => unknown;
    /** `typeof "".charCodeAt` → "function" */
    const charCodeAt: (...args: unknown[]) => unknown;
    /** `typeof "".indexOf` → "function" */
    const indexOf: (...args: unknown[]) => unknown;
    /** `typeof "".lastIndexOf` → "function" */
    const lastIndexOf: (...args: unknown[]) => unknown;
    /** `typeof "".slice` → "function" */
    const slice: (...args: unknown[]) => unknown;
    /** `typeof "".substring` → "function" */
    const substring: (...args: unknown[]) => unknown;
    /** `typeof "".split` → "function" */
    const split: (...args: unknown[]) => unknown;
    /** `typeof "".replace` → "function" */
    const replace: (...args: unknown[]) => unknown;
    /** `typeof "".trim` → "function" */
    const trim: (...args: unknown[]) => unknown;
    /** `typeof "".toLowerCase` → "function" */
    const toLowerCase: (...args: unknown[]) => unknown;
    /** `typeof "".toUpperCase` → "function" */
    const toUpperCase: (...args: unknown[]) => unknown;
  }
  namespace String {
    /** `typeof String.fromCharCode` → "function" */
    const fromCharCode: (...args: unknown[]) => unknown;
  }
  namespace JSON {
    /** `typeof JSON.parse` → "function" */
    const parse: (...args: unknown[]) => unknown;
    /** `typeof JSON.stringify` → "function" */
    const stringify: (...args: unknown[]) => unknown;
  }
  namespace Object {
    /** `typeof Object.keys` → "function" */
    const keys: (...args: unknown[]) => unknown;
    /** `typeof Object.assign` → "function" */
    const assign: (...args: unknown[]) => unknown;
  }
  namespace Math {
    /** `typeof Math.round` → "function" */
    const round: (...args: unknown[]) => unknown;
  }
  namespace Date {
    /** `typeof Date.now` → "function" */
    const now: (...args: unknown[]) => unknown;
  }
  /** `typeof parseInt` → "function" */
  const parseInt: (...args: unknown[]) => unknown;
  /** `typeof parseFloat` → "function" */
  const parseFloat: (...args: unknown[]) => unknown;
  /** `typeof isNaN` → "function" */
  const isNaN: (...args: unknown[]) => unknown;
  /** `typeof btoa` → "function" */
  const btoa: (...args: unknown[]) => unknown;
  /** `typeof atob` → "function" */
  const atob: (...args: unknown[]) => unknown;
  /** `typeof btoh` → "function" */
  const btoh: (...args: unknown[]) => unknown;
  /** `typeof ArrayBuffer` → "function" */
  const ArrayBuffer: (...args: unknown[]) => unknown;
  /** `typeof Uint8Array` → "function" */
  const Uint8Array: (...args: unknown[]) => unknown;
  /** `typeof print` → "function" */
  const print: (...args: unknown[]) => unknown;
  namespace console {
    /** `typeof console.log` → "function" */
    const log: (...args: unknown[]) => unknown;
  }
  namespace Timer {
    /** `typeof Timer.set` → "function" */
    const set: (...args: unknown[]) => unknown;
    /** `typeof Timer.clear` → "function" */
    const clear: (...args: unknown[]) => unknown;
    /** `typeof Timer.getInfo` → "function" */
    const getInfo: (...args: unknown[]) => unknown;
  }
  namespace Shelly {
    /** `typeof Shelly.call` → "function" */
    const call: (...args: unknown[]) => unknown;
    /** `typeof Shelly.getComponentStatus` → "function" */
    const getComponentStatus: (...args: unknown[]) => unknown;
    /** `typeof Shelly.getComponentConfig` → "function" */
    const getComponentConfig: (...args: unknown[]) => unknown;
    /** `typeof Shelly.getDeviceInfo` → "function" */
    const getDeviceInfo: (...args: unknown[]) => unknown;
    /** `typeof Shelly.getCurrentScriptId` → "function" */
    const getCurrentScriptId: (...args: unknown[]) => unknown;
    /** `typeof Shelly.getUptimeMs` → "function" */
    const getUptimeMs: (...args: unknown[]) => unknown;
    /** `typeof Shelly.emitEvent` → "function" */
    const emitEvent: (...args: unknown[]) => unknown;
    /** `typeof Shelly.addEventHandler` → "function" */
    const addEventHandler: (...args: unknown[]) => unknown;
    /** `typeof Shelly.addStatusHandler` → "function" */
    const addStatusHandler: (...args: unknown[]) => unknown;
  }
  namespace Script {
    /** `typeof Script.id` → "number" */
    const id: number;
    /** `typeof Script.storage` → "object" */
    const storage: object;
    /** `typeof Script.addRpcHandler` → "function" */
    const addRpcHandler: (...args: unknown[]) => unknown;
    /** `typeof Script.getVcHandle` → "function" */
    const getVcHandle: (...args: unknown[]) => unknown;
  }
  namespace Virtual {
    /** `typeof Virtual.getHandle` → "function" */
    const getHandle: (...args: unknown[]) => unknown;
  }
  /** `typeof HTTPServer` → "function" */
  const HTTPServer: (...args: unknown[]) => unknown;
  /** `typeof MQTT` → "function" */
  const MQTT: (...args: unknown[]) => unknown;
  /** `typeof BLE` → "function" */
  const BLE: (...args: unknown[]) => unknown;
  /** `typeof AES` → "function" */
  const AES: (...args: unknown[]) => unknown;
  namespace binary {
    namespace uint8 {
      /** `(function () { try { return typeof new Uint8Array(2); } catch (e) { return "throws:" + (e.message || e); } })()` → "object" */
      const construct: object;
      /** `(function () { try { return typeof new Uint8Array(2)[0]; } catch (e) { return "throws:" + (e.message || e); } })()` → "number" */
      const element: number;
      /** `(function () { try { return typeof new Uint8Array(2).buffer; } catch (e) { return "throws:" + (e.message || e); } })()` → "object" */
      const backing: object;
    }
  }
}
