/**
 * `node:crypto` shim — not in the plan's original three-file list, added
 * because bundling `server/lint/check.ts` empirically pulls it in:
 * check.ts -> device-profile.ts -> rpc.ts -> auth-digest.ts, which imports
 * `createHash`/`randomBytes` to answer a device's digest-auth challenge.
 * That code path only runs mid-RPC-round-trip against a real device, which
 * `runCheck({ connected: false })` never initiates — so the import must
 * *resolve* for the bundle to build, but is provably never *called*.
 * Real Web Crypto (`SubtleCrypto`) has a different, async-only shape, so
 * rather than half-porting Node's sync `crypto` API for dead code, these
 * throw if that ever changes and this genuinely gets invoked offline.
 */
export function createHash(): never {
  throw new Error("node:crypto is not available in the static build");
}
export function randomBytes(): never {
  throw new Error("node:crypto is not available in the static build");
}

export default { createHash, randomBytes };
