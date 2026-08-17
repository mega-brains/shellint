// @ts-ignore Node typecheck lacks txiki.js builtin declarations.
import path from "tjs:path";
// @ts-ignore Node typecheck lacks txiki.js builtin declarations.
import { createHash } from "tjs:hashing";
import type {
  RuntimeAdapter,
  RuntimeChildProcess,
  RuntimeDirEntry,
  RuntimeFs,
  RuntimeProcess,
  RuntimeProcessStatus,
  RuntimeReadableStream,
  RuntimeSpawnOptions,
  RuntimeStat,
  RuntimeWebSocket,
  RuntimeWebSocketClose,
  RuntimeWebSocketMessage,
  RuntimeWebSocketState,
} from "./types.ts";

type TxikiDirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
};

type TxikiStat = TxikiDirEntry & {
  mode: number;
  size: number;
  mtim: Date;
};

type TxikiDir = AsyncIterable<TxikiDirEntry>;
type TxikiChild = {
  pid: number;
  stdin: WritableStream<Uint8Array> | null;
  stdout: RuntimeReadableStream | null;
  stderr: RuntimeReadableStream | null;
  kill(signal?: string): void;
  wait(): Promise<{ exit_status: number; term_signal: string | null }>;
};

type TxikiGlobal = {
  args: readonly string[];
  env: Record<string, string | undefined>;
  cwd: string;
  exit(code: number): void;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: { mode?: number },
  ): Promise<void>;
  makeDir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>;
  readDir(path: string): Promise<TxikiDir>;
  stat(path: string): Promise<TxikiStat>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string, options?: { maxRetries?: number; retryDelay?: number }): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  spawn(
    argv: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      stdin?: "inherit" | "pipe" | "ignore";
      stdout?: "inherit" | "pipe" | "ignore";
      stderr?: "inherit" | "pipe" | "ignore";
    },
  ): TxikiChild;
};

type TxikiMessageEvent = { data: string | ArrayBuffer };
type TxikiErrorEvent = { error?: unknown; message?: string };
type TxikiCloseEvent = { code: number; reason: string; wasClean: boolean };
type TxikiSocket = {
  readyState: number;
  binaryType: string;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: TxikiMessageEvent) => void): void;
  addEventListener(type: "error", listener: (event: TxikiErrorEvent) => void): void;
  addEventListener(type: "close", listener: (event: TxikiCloseEvent) => void): void;
  removeEventListener(type: "open", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: TxikiMessageEvent) => void): void;
  removeEventListener(type: "error", listener: (event: TxikiErrorEvent) => void): void;
  removeEventListener(type: "close", listener: (event: TxikiCloseEvent) => void): void;
};
type TxikiSocketConstructor = new (url: string) => TxikiSocket;

const txiki = (globalThis as unknown as { tjs: TxikiGlobal }).tjs;
const NativeWebSocket = (
  globalThis as unknown as { WebSocket: TxikiSocketConstructor }
).WebSocket;

function platform(): string {
  const navigator = (
    globalThis as unknown as {
      navigator?: { platform?: string; userAgentData?: { platform?: string } };
    }
  ).navigator;
  const name = navigator?.userAgentData?.platform ?? navigator?.platform ?? "unknown";
  if (/mac/i.test(name)) return "darwin";
  if (/win/i.test(name)) return "win32";
  if (/linux/i.test(name)) return "linux";
  return name.toLowerCase();
}

function args(): readonly string[] {
  if (txiki.args[1] !== "run" || txiki.args.length < 3) return txiki.args;
  return Object.freeze([txiki.args[0], ...txiki.args.slice(2)]);
}

function definedEnv(
  env: Record<string, string | undefined> | undefined,
): Record<string, string> | undefined {
  if (!env) return undefined;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function atomicPath(target: string): string {
  const random = crypto.getRandomValues(new Uint8Array(8));
  let suffix = "";
  for (const byte of random) suffix += byte.toString(16).padStart(2, "0");
  return path.join(path.dirname(target), `.${path.basename(target)}.${suffix}.tmp`);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

const fs: RuntimeFs = {
  async exists(target) {
    try {
      await txiki.stat(target);
      return true;
    } catch {
      return false;
    }
  },
  async readText(target) {
    return new TextDecoder().decode(await txiki.readFile(target));
  },
  readBytes(target) {
    return txiki.readFile(target);
  },
  writeText(target, text, options) {
    return txiki.writeFile(target, text, options);
  },
  writeBytes(target, bytes, options) {
    return txiki.writeFile(target, bytes, options);
  },
  async atomicWriteText(target, text, options) {
    const temporary = atomicPath(target);
    try {
      await txiki.writeFile(temporary, text, options);
      await txiki.rename(temporary, target);
    } catch (error) {
      await txiki.remove(temporary).catch(() => undefined);
      throw error;
    }
  },
  mkdir(target, options) {
    return txiki.makeDir(target, options);
  },
  async readDir(target) {
    const entries: RuntimeDirEntry[] = [];
    for await (const entry of await txiki.readDir(target)) {
      entries.push({
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
        isSymbolicLink: entry.isSymbolicLink,
      });
    }
    return entries;
  },
  async stat(target): Promise<RuntimeStat> {
    const result = await txiki.stat(target);
    return {
      size: result.size,
      mode: result.mode,
      mtimeMs: result.mtim.getTime(),
      isFile: result.isFile,
      isDirectory: result.isDirectory,
      isSymbolicLink: result.isSymbolicLink,
    };
  },
  rename(from, to) {
    return txiki.rename(from, to);
  },
  async remove(target, options) {
    const txikiOptions: { maxRetries?: number; retryDelay?: number } = {};
    if (options?.maxRetries !== undefined) txikiOptions.maxRetries = options.maxRetries;
    if (options?.retryDelay !== undefined) txikiOptions.retryDelay = options.retryDelay;
    try {
      await txiki.remove(target, txikiOptions);
    } catch (error) {
      if (!options?.force || errorCode(error) !== "ENOENT") throw error;
    }
  },
  chmod(target, mode) {
    return txiki.chmod(target, mode);
  },
};

function spawn(argv: readonly string[], options: RuntimeSpawnOptions = {}): RuntimeChildProcess {
  if (argv.length === 0) throw new TypeError("spawn requires executable");
  const child = txiki.spawn([...argv], {
    cwd: options.cwd,
    env: definedEnv(options.env),
    stdin: options.stdin,
    stdout: options.stdout,
    stderr: options.stderr,
  });
  const waitPromise = child.wait().then(
    (status): RuntimeProcessStatus => ({
      exitStatus: status.exit_status,
      termSignal: status.term_signal,
    }),
  );
  return {
    pid: child.pid,
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    kill(signal) {
      child.kill(signal);
    },
    wait() {
      return waitPromise;
    },
  };
}

function socketState(value: number): RuntimeWebSocketState {
  if (value === 0) return "connecting";
  if (value === 1) return "open";
  if (value === 2) return "closing";
  return "closed";
}

class TxikiWebSocket implements RuntimeWebSocket {
  readonly #socket: TxikiSocket;

  constructor(url: string) {
    this.#socket = new NativeWebSocket(url);
    this.#socket.binaryType = "arraybuffer";
  }

  get state(): RuntimeWebSocketState {
    return socketState(this.#socket.readyState);
  }

  send(data: RuntimeWebSocketMessage): void {
    this.#socket.send(data);
  }

  close(code?: number, reason?: string): void {
    this.#socket.close(code, reason);
  }

  abort(): void {
    this.#socket.close();
  }

  onOpen(listener: () => void): () => void {
    this.#socket.addEventListener("open", listener);
    return () => this.#socket.removeEventListener("open", listener);
  }

  onMessage(listener: (data: RuntimeWebSocketMessage) => void): () => void {
    const wrapped = (event: TxikiMessageEvent) =>
      listener(typeof event.data === "string" ? event.data : new Uint8Array(event.data));
    this.#socket.addEventListener("message", wrapped);
    return () => this.#socket.removeEventListener("message", wrapped);
  }

  onError(listener: (error: Error) => void): () => void {
    const wrapped = (event: TxikiErrorEvent) => {
      const error = event.error;
      listener(error instanceof Error ? error : new Error(event.message ?? "WebSocket error"));
    };
    this.#socket.addEventListener("error", wrapped);
    return () => this.#socket.removeEventListener("error", wrapped);
  }

  onClose(listener: (event: RuntimeWebSocketClose) => void): () => void {
    const wrapped = (event: TxikiCloseEvent) => listener(event);
    this.#socket.addEventListener("close", wrapped);
    return () => this.#socket.removeEventListener("close", wrapped);
  }
}

export const runtime: RuntimeAdapter = {
  fs,
  path,
  process: {
    get args() {
      return args();
    },
    get env() {
      return txiki.env;
    },
    get cwd() {
      return txiki.cwd;
    },
    get platform() {
      return platform();
    },
    exit(code): never {
      txiki.exit(code);
      throw new Error("unreachable");
    },
    spawn,
  } satisfies RuntimeProcess,
  crypto: {
    sha256Hex(data) {
      return createHash("sha256").update(data).digest();
    },
    randomBytes(length) {
      const bytes = new Uint8Array(length);
      for (let offset = 0; offset < length; offset += 65_536) {
        crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65_536, length)));
      }
      return bytes;
    },
  },
  websocket: {
    connect(url) {
      return new TxikiWebSocket(url);
    },
  },
  byteLength(text) {
    return new TextEncoder().encode(text).byteLength;
  },
};

export default runtime;
