import WebSocket from "ws";

export class AuthNotSupportedError extends Error {
  constructor() {
    super("auth not supported yet");
    this.name = "AuthNotSupportedError";
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

type Pending = {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
};

/**
 * Unauthenticated Shelly Gen2 WebSocket RPC client.
 * Sends ≥1 request with valid `src` on connect (Shelly WS requirement).
 */
export class ShellyRpc {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readonly src = "shelly-devroom";
  private openPromise: Promise<void> | null = null;

  constructor(private readonly deviceIp: string) {}

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise<void>((resolve, reject) => {
      const url = `ws://${this.deviceIp}/rpc`;
      const ws = new WebSocket(url);
      this.ws = ws;

      const fail = (err: Error) => {
        this.cleanup();
        reject(err);
      };

      ws.on("open", () => {
        // Warm the channel with a valid src (required before notifications / further use).
        this.call("Shelly.GetDeviceInfo", {})
          .then(() => resolve())
          .catch((err: unknown) => {
            if (err instanceof AuthNotSupportedError) {
              fail(err);
              return;
            }
            // Some firmwares may lack GetDeviceInfo under that name — fall back to Script.List.
            this.call("Script.List", {})
              .then(() => resolve())
              .catch((e2: unknown) => fail(e2 instanceof Error ? e2 : new Error(String(e2))));
          });
      });

      ws.on("message", (data) => this.onMessage(data.toString()));

      ws.on("error", (err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      });

      ws.on("close", () => {
        for (const [, p] of this.pending) {
          p.reject(new Error("WebSocket closed"));
        }
        this.pending.clear();
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
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.openPromise = null;
    for (const [, p] of this.pending) {
      p.reject(new Error("connection failed"));
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

    if (msg.error) {
      const code = msg.error.code ?? -1;
      const message = msg.error.message ?? "RPC error";
      if (code === 401 || /auth_type|digest|Unauthorized/i.test(message)) {
        pending.reject(new AuthNotSupportedError());
        return;
      }
      pending.reject(new RpcError(code, message));
      return;
    }
    pending.resolve(msg.result);
  }

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    const id = this.nextId++;
    const frame = {
      jsonrpc: "2.0",
      id,
      src: this.src,
      method,
      params,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(frame));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 15_000);
    });
  }

  close() {
    this.cleanup();
  }
}
