import { runtime } from "#shellint/runtime";
import type { RuntimeWebSocket, RuntimeWebSocketMessage } from "../runtime/types.ts";
import { buildAuthFrame, NonceCounter, type DigestChallenge } from "./auth-digest.ts";

export class AuthNotSupportedError extends Error {
  constructor(detail?: string) {
    super(detail ? `auth not supported yet — ${detail}` : "auth not supported yet");
    this.name = "AuthNotSupportedError";
  }
}

/** Digest auth was attempted (password configured, `auth_type:"digest"`) and failed twice. */
export class AuthFailedError extends Error {
  constructor(detail?: string) {
    super(detail ? `wrong device password — ${detail}` : "wrong device password");
    this.name = "AuthFailedError";
  }
}

export class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

export type RpcTarget = {
  ip: string;
  auth?: { username?: string; password: string };
};

type Pending = {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  /** Cleared on settle, otherwise it holds the event loop open until it fires. */
  timer: ReturnType<typeof setTimeout>;
  method: string;
  params: Record<string, unknown>;
  retried: boolean;
};

function messageText(data: RuntimeWebSocketMessage): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

const CONNECT_TIMEOUT_MS = 9_000;
const RPC_TIMEOUT_MS = 10_000;

function parseChallenge(message: string): DigestChallenge | null {
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    if (parsed.auth_type !== "digest") return null;
    if (typeof parsed.realm !== "string") return null;
    if (typeof parsed.nonce !== "number" && typeof parsed.nonce !== "string") {
      return null;
    }
    return {
      realm: parsed.realm,
      nonce: parsed.nonce,
      stale: parsed.stale === true,
    };
  } catch {
    return null;
  }
}

/**
 * Shelly Gen2 WebSocket RPC client. Sends ≥1 request with valid `src` on
 * connect (Shelly WS requirement). Optional digest auth: a 401 challenge with
 * `auth_type:"digest"` is answered once per request; a second 401 on the
 * retry becomes `AuthFailedError`.
 */
export class ShellyRpc {
  private ws: RuntimeWebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readonly src = "shellint";
  private openPromise: Promise<void> | null = null;
  private readonly ip: string;
  private readonly auth?: { username?: string; password: string };
  private nonces = new NonceCounter();

  constructor(target: string | RpcTarget) {
    if (typeof target === "string") {
      this.ip = target;
    } else {
      this.ip = target.ip;
      this.auth = target.auth;
    }
  }

  async connect(): Promise<void> {
    if (this.ws?.state === "open") return;
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise<void>((resolve, reject) => {
      const url = `ws://${this.ip}/rpc`;
      const ws = runtime.websocket.connect(url);
      this.ws = ws;
      let settled = false;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cleanup();
        reject(err);
      };

      const ok = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      const timer = setTimeout(() => {
        fail(new Error(`connect timeout to ${url} (${CONNECT_TIMEOUT_MS}ms)`));
      }, CONNECT_TIMEOUT_MS);

      ws.onOpen(() => {
        // Warm the channel with a valid src (required before notifications / further use).
        this.call("Shelly.GetDeviceInfo", {})
          .then(() => ok())
          .catch((err: unknown) => {
            if (err instanceof AuthNotSupportedError || err instanceof AuthFailedError) {
              fail(err);
              return;
            }
            this.call("Script.List", {})
              .then(() => ok())
              .catch((e2: unknown) =>
                fail(e2 instanceof Error ? e2 : new Error(String(e2))),
              );
          });
      });

      ws.onMessage((data) => this.onMessage(messageText(data)));

      ws.onError((err) => {
        fail(
          err instanceof Error
            ? err
            : new Error(`WebSocket error connecting to ${url}`),
        );
      });

      ws.onClose(() => {
        this.rejectAll(new Error("WebSocket closed"));
        this.ws = null;
        this.openPromise = null;
      });
    });

    try {
      await this.openPromise;
    } catch (e) {
      this.openPromise = null;
      throw e;
    }
  }

  private cleanup() {
    if (this.ws) {
      try {
        this.ws.abort();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.openPromise = null;
    this.rejectAll(new Error("connection failed"));
  }

  private rejectAll(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private onMessage(raw: string) {
    let msg: {
      id?: number;
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id == null) return; // notification
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    clearTimeout(pending.timer);

    if (msg.error) {
      const code = msg.error.code ?? -1;
      const message = msg.error.message ?? "RPC error";
      if (code === 401 || /auth_type|digest|Unauthorized/i.test(message)) {
        this.handleChallenge(pending, message);
        return;
      }
      pending.reject(new RpcError(code, message));
      return;
    }
    pending.resolve(msg.result);
  }

  private handleChallenge(pending: Pending, message: string): void {
    const challenge = parseChallenge(message);
    if (!challenge) {
      pending.reject(new AuthNotSupportedError());
      return;
    }
    if (!this.auth?.password) {
      pending.reject(
        new AuthFailedError("device requires a password but none is configured"),
      );
      return;
    }
    if (pending.retried) {
      pending.reject(new AuthFailedError());
      return;
    }
    if (challenge.stale) this.nonces.reset();

    const nc = this.nonces.next(challenge.nonce);
    const authFrame = buildAuthFrame({
      realm: challenge.realm,
      nonce: challenge.nonce,
      password: this.auth.password,
      nc,
      username: this.auth.username,
    });

    this.send(pending.method, pending.params, {
      resolve: pending.resolve,
      reject: pending.reject,
      retried: true,
      auth: authFrame,
    });
  }

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.send(method, params, { resolve, reject, retried: false });
    });
  }

  private send(
    method: string,
    params: Record<string, unknown>,
    ctx: {
      resolve: (result: unknown) => void;
      reject: (err: Error) => void;
      retried: boolean;
      auth?: ReturnType<typeof buildAuthFrame>;
    },
  ): void {
    if (!this.ws || this.ws.state !== "open") {
      ctx.reject(new Error("WebSocket not connected"));
      return;
    }
    const id = this.nextId++;
    const frame: Record<string, unknown> = {
      jsonrpc: "2.0",
      id,
      src: this.src,
      method,
      params,
    };
    if (ctx.auth) frame.auth = ctx.auth;

    const timer = setTimeout(() => {
      if (this.pending.delete(id)) {
        ctx.reject(new Error(`RPC timeout: ${method}`));
      }
    }, RPC_TIMEOUT_MS);
    this.pending.set(id, {
      resolve: ctx.resolve,
      reject: ctx.reject,
      timer,
      method,
      params,
      retried: ctx.retried,
    });
    this.ws.send(JSON.stringify(frame));
  }

  close() {
    this.cleanup();
  }
}
