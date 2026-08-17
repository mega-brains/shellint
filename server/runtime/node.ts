import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import nodePath from "node:path";
import { Readable, Writable } from "node:stream";
import WebSocket, { type RawData } from "ws";
import type {
  RuntimeAdapter,
  RuntimeChildProcess,
  RuntimeFs,
  RuntimeProcess,
  RuntimeProcessStatus,
  RuntimeReadableStream,
  RuntimeSpawnOptions,
  RuntimeWebSocket,
  RuntimeWebSocketClose,
  RuntimeWebSocketMessage,
  RuntimeWebSocketState,
} from "./types.ts";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function readableStream(stream: Readable): RuntimeReadableStream {
  const web = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  return Object.assign(web, {
    async bytes() {
      return readAll(web);
    },
    async arrayBuffer() {
      const bytes = await readAll(web);
      return bytes.slice().buffer;
    },
    async text() {
      return new TextDecoder().decode(await readAll(web));
    },
  });
}

function atomicPath(path: string): string {
  const suffix = randomBytes(8).toString("hex");
  return nodePath.join(nodePath.dirname(path), `.${nodePath.basename(path)}.${suffix}.tmp`);
}

const fs: RuntimeFs = {
  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  readText(path) {
    return readFile(path, "utf8");
  },
  async readBytes(path) {
    return new Uint8Array(await readFile(path));
  },
  writeText(path, text, options) {
    return writeFile(path, text, { encoding: "utf8", mode: options?.mode });
  },
  writeBytes(path, bytes, options) {
    return writeFile(path, bytes, { mode: options?.mode });
  },
  async atomicWriteText(path, text, options) {
    const temporary = atomicPath(path);
    try {
      await writeFile(temporary, text, { encoding: "utf8", mode: options?.mode });
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  },
  mkdir(path, options) {
    return mkdir(path, options).then(() => undefined);
  },
  async readDir(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
      isSymbolicLink: entry.isSymbolicLink(),
    }));
  },
  async stat(path) {
    const result = await stat(path);
    return {
      size: result.size,
      mode: result.mode,
      mtimeMs: result.mtimeMs,
      isFile: result.isFile(),
      isDirectory: result.isDirectory(),
      isSymbolicLink: result.isSymbolicLink(),
    };
  },
  rename,
  remove(path, options) {
    return rm(path, { ...options, recursive: true });
  },
  chmod,
};

function processStatus(child: ChildProcess): Promise<RuntimeProcessStatus> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ exitStatus: code ?? 0, termSignal: signal });
    });
  });
}

function spawn(argv: readonly string[], options: RuntimeSpawnOptions = {}): RuntimeChildProcess {
  if (argv.length === 0) throw new TypeError("spawn requires executable");
  const child = nodeSpawn(argv[0], argv.slice(1), {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.stdin ?? "inherit", options.stdout ?? "inherit", options.stderr ?? "inherit"],
  });
  const waitPromise = processStatus(child);
  return {
    pid: child.pid ?? -1,
    stdin: child.stdin ? (Writable.toWeb(child.stdin) as WritableStream<Uint8Array>) : null,
    stdout: child.stdout ? readableStream(child.stdout) : null,
    stderr: child.stderr ? readableStream(child.stderr) : null,
    kill(signal) {
      child.kill(signal as NodeJS.Signals | undefined);
    },
    wait() {
      return waitPromise;
    },
  };
}

function wsState(value: number): RuntimeWebSocketState {
  if (value === WebSocket.CONNECTING) return "connecting";
  if (value === WebSocket.OPEN) return "open";
  if (value === WebSocket.CLOSING) return "closing";
  return "closed";
}

function wsMessage(data: RawData, isBinary: boolean): RuntimeWebSocketMessage {
  if (!isBinary) return data.toString();
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) {
    const length = data.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of data) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

class NodeWebSocket implements RuntimeWebSocket {
  readonly #socket: WebSocket;

  constructor(url: string) {
    this.#socket = new WebSocket(url);
  }

  get state(): RuntimeWebSocketState {
    return wsState(this.#socket.readyState);
  }

  send(data: RuntimeWebSocketMessage): void {
    this.#socket.send(data);
  }

  close(code?: number, reason?: string): void {
    this.#socket.close(code, reason);
  }

  abort(): void {
    this.#socket.terminate();
  }

  onOpen(listener: () => void): () => void {
    this.#socket.on("open", listener);
    return () => this.#socket.off("open", listener);
  }

  onMessage(listener: (data: RuntimeWebSocketMessage) => void): () => void {
    const wrapped = (data: RawData, isBinary: boolean) => listener(wsMessage(data, isBinary));
    this.#socket.on("message", wrapped);
    return () => this.#socket.off("message", wrapped);
  }

  onError(listener: (error: Error) => void): () => void {
    this.#socket.on("error", listener);
    return () => this.#socket.off("error", listener);
  }

  onClose(listener: (event: RuntimeWebSocketClose) => void): () => void {
    const wrapped = (code: number, reason: Buffer) =>
      listener({ code, reason: reason.toString(), wasClean: code === 1000 });
    this.#socket.on("close", wrapped);
    return () => this.#socket.off("close", wrapped);
  }
}

export const runtime: RuntimeAdapter = {
  fs,
  path: nodePath,
  process: {
    get args() {
      return process.argv;
    },
    get env() {
      return process.env;
    },
    get cwd() {
      return process.cwd();
    },
    get platform() {
      return process.platform;
    },
    exit(code): never {
      process.exit(code);
    },
    spawn,
  } satisfies RuntimeProcess,
  crypto: {
    sha256Hex(data) {
      return createHash("sha256").update(data).digest("hex");
    },
    randomBytes(length) {
      return new Uint8Array(randomBytes(length));
    },
  },
  websocket: {
    connect(url) {
      return new NodeWebSocket(url);
    },
  },
  byteLength(text) {
    return new TextEncoder().encode(text).byteLength;
  },
};

export default runtime;
