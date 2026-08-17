export type RuntimeDirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
};

export type RuntimeStat = {
  size: number;
  mode: number;
  mtimeMs: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
};

export type RuntimeWriteOptions = {
  mode?: number;
};

export type RuntimeMkdirOptions = {
  recursive?: boolean;
  mode?: number;
};

export type RuntimeRemoveOptions = {
  force?: boolean;
  maxRetries?: number;
  retryDelay?: number;
};

export interface RuntimeFs {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeText(path: string, text: string, options?: RuntimeWriteOptions): Promise<void>;
  writeBytes(
    path: string,
    bytes: Uint8Array,
    options?: RuntimeWriteOptions,
  ): Promise<void>;
  atomicWriteText(
    path: string,
    text: string,
    options?: RuntimeWriteOptions,
  ): Promise<void>;
  mkdir(path: string, options?: RuntimeMkdirOptions): Promise<void>;
  readDir(path: string): Promise<RuntimeDirEntry[]>;
  stat(path: string): Promise<RuntimeStat>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string, options?: RuntimeRemoveOptions): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
}

export interface RuntimePath {
  readonly sep: string;
  basename(path: string): string;
  dirname(path: string): string;
  extname(path: string): string;
  isAbsolute(path: string): boolean;
  join(...paths: string[]): string;
  normalize(path: string): string;
  relative(from: string, to: string): string;
  resolve(...paths: string[]): string;
}

export type RuntimeStdio = "inherit" | "pipe" | "ignore";

export type RuntimeSpawnOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: RuntimeStdio;
  stdout?: RuntimeStdio;
  stderr?: RuntimeStdio;
};

export type RuntimeProcessStatus = {
  exitStatus: number;
  termSignal: string | null;
};

export interface RuntimeReadableStream extends ReadableStream<Uint8Array> {
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}

export interface RuntimeChildProcess {
  readonly pid: number;
  readonly stdin: WritableStream<Uint8Array> | null;
  readonly stdout: RuntimeReadableStream | null;
  readonly stderr: RuntimeReadableStream | null;
  kill(signal?: string): void;
  wait(): Promise<RuntimeProcessStatus>;
}

export interface RuntimeProcess {
  readonly args: readonly string[];
  readonly env: Record<string, string | undefined>;
  readonly cwd: string;
  readonly platform: string;
  exit(code: number): never;
  spawn(argv: readonly string[], options?: RuntimeSpawnOptions): RuntimeChildProcess;
}

export interface RuntimeCrypto {
  sha256Hex(data: string | Uint8Array): string;
  randomBytes(length: number): Uint8Array;
}

export type RuntimeWebSocketState = "connecting" | "open" | "closing" | "closed";
export type RuntimeWebSocketMessage = string | Uint8Array;
export type RuntimeWebSocketClose = {
  code: number;
  reason: string;
  wasClean: boolean;
};
export type RuntimeUnsubscribe = () => void;

export interface RuntimeWebSocket {
  readonly state: RuntimeWebSocketState;
  send(data: RuntimeWebSocketMessage): void;
  close(code?: number, reason?: string): void;
  abort(): void;
  onOpen(listener: () => void): RuntimeUnsubscribe;
  onMessage(listener: (data: RuntimeWebSocketMessage) => void): RuntimeUnsubscribe;
  onError(listener: (error: Error) => void): RuntimeUnsubscribe;
  onClose(listener: (event: RuntimeWebSocketClose) => void): RuntimeUnsubscribe;
}

export interface RuntimeWebSocketFactory {
  connect(url: string): RuntimeWebSocket;
}

export interface RuntimeAdapter {
  readonly fs: RuntimeFs;
  readonly path: RuntimePath;
  readonly process: RuntimeProcess;
  readonly crypto: RuntimeCrypto;
  readonly websocket: RuntimeWebSocketFactory;
  byteLength(text: string): number;
}
