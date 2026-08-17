import { runtime } from "#devroom/runtime";

/**
 * Shelly Gen2 digest auth (https://shelly-api-docs.shelly.cloud/gen2/General/Authentication).
 * Pure functions, no I/O — `rpc.ts` owns the socket and the nonce cache.
 *
 *   ha1      = SHA256("admin:" + realm + ":" + password)
 *   ha2      = SHA256("dummy_method:dummy_uri")
 *   response = SHA256(ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":auth:" + ha2)
 */

export type DigestChallenge = {
  realm: string;
  nonce: number | string;
  /** `true` ⇒ this nonce is expired; re-challenge with the fresh one rather than fail. */
  stale?: boolean;
};

export type DigestAuthFrame = {
  realm: string;
  username: string;
  nonce: number | string;
  cnonce: string;
  nc: string;
  response: string;
  algorithm: "SHA-256";
};

const USERNAME = "admin";

function sha256(s: string): string {
  return runtime.crypto.sha256Hex(s);
}

export function computeDigestResponse(opts: {
  realm: string;
  nonce: number | string;
  cnonce: string;
  nc: string;
  password: string;
  username?: string;
}): string {
  const username = opts.username ?? USERNAME;
  const ha1 = sha256(`${username}:${opts.realm}:${opts.password}`);
  const ha2 = sha256("dummy_method:dummy_uri");
  return sha256(`${ha1}:${opts.nonce}:${opts.nc}:${opts.cnonce}:auth:${ha2}`);
}

export function makeCnonce(): string {
  let hex = "";
  for (const byte of runtime.crypto.randomBytes(8)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function buildAuthFrame(opts: {
  realm: string;
  nonce: number | string;
  password: string;
  nc: string;
  cnonce?: string;
  username?: string;
}): DigestAuthFrame {
  const cnonce = opts.cnonce ?? makeCnonce();
  const username = opts.username ?? USERNAME;
  const response = computeDigestResponse({
    realm: opts.realm,
    nonce: opts.nonce,
    cnonce,
    nc: opts.nc,
    password: opts.password,
    username,
  });
  return {
    realm: opts.realm,
    username,
    nonce: opts.nonce,
    cnonce,
    nc: opts.nc,
    response,
    algorithm: "SHA-256",
  };
}

/**
 * Per-nonce request counter (`nc`, 8 hex digits, increments each use against
 * the same nonce). A `stale:true` challenge means "re-challenge with the new
 * nonce", not a failure — call `reset()` and start over on that nonce.
 */
export class NonceCounter {
  private counts = new Map<string, number>();

  next(nonce: number | string): string {
    const key = String(nonce);
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n.toString(16).padStart(8, "0");
  }

  reset(): void {
    this.counts.clear();
  }
}
