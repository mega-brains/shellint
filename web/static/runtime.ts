import type {
  RuntimeAdapter,
  RuntimeChildProcess,
  RuntimeWebSocket,
} from "../../server/runtime/types.ts";
import path from "./node-shims/path.ts";
import {
  vfsDelete,
  vfsExists,
  vfsMkdir,
  vfsRead,
  vfsReaddir,
  vfsRename,
  vfsStat,
  vfsWrite,
} from "./vfs.ts";

function unavailable(name: string): never {
  throw new Error(`${name} is unavailable in static mode`);
}

export const runtime: RuntimeAdapter = {
  fs: {
    async exists(target) {
      return vfsExists(target);
    },
    async readText(target) {
      return vfsRead(target);
    },
    async readBytes(target) {
      return new TextEncoder().encode(vfsRead(target));
    },
    async writeText(target, text) {
      vfsWrite(target, text);
    },
    async writeBytes(target, bytes) {
      vfsWrite(target, new TextDecoder().decode(bytes));
    },
    async atomicWriteText(target, text) {
      vfsWrite(target, text);
    },
    async mkdir() {
      vfsMkdir();
    },
    async readDir(target) {
      return vfsReaddir(target).map((name) => ({
        name,
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
      }));
    },
    async stat(target) {
      const stat = vfsStat(target);
      const text = vfsRead(target);
      return {
        size: new TextEncoder().encode(text).byteLength,
        mode: 0o644,
        mtimeMs: stat.mtimeMs,
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
      };
    },
    async rename(from, to) {
      vfsRename(from, to);
    },
    async remove(target) {
      vfsDelete(target);
    },
    async chmod() {},
  },
  path,
  process: {
    args: [],
    env: {},
    cwd: "/repo",
    platform: "browser",
    exit(): never {
      return unavailable("runtime exit");
    },
    spawn(): RuntimeChildProcess {
      return unavailable("runtime spawn");
    },
  },
  crypto: {
    sha256Hex() {
      return unavailable("crypto.sha256Hex");
    },
    randomBytes(length) {
      return crypto.getRandomValues(new Uint8Array(length));
    },
  },
  websocket: {
    connect(): RuntimeWebSocket {
      return unavailable("WebSocket");
    },
  },
  byteLength(text) {
    return new TextEncoder().encode(text).byteLength;
  },
};

export default runtime;
