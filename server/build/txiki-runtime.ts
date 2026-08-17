import type { RuntimeAdapter } from "./runtime-adapter.ts";

type TxikiRuntime = {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, contents: string | Uint8Array): Promise<void>;
  stat(path: string): Promise<unknown>;
  makeDir(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove(path: string): Promise<void>;
};

function globalRuntime(): TxikiRuntime {
  const value = (globalThis as unknown as { tjs?: TxikiRuntime }).tjs;
  if (!value) throw new Error("txiki.js global `tjs` is unavailable");
  return value;
}

/** Native txiki.js adapter. No Node compatibility layer required. */
export function createTxikiRuntimeAdapter(
  runtime: TxikiRuntime = globalRuntime(),
): RuntimeAdapter {
  return {
    async readText(path) {
      return new TextDecoder().decode(await runtime.readFile(path));
    },
    async writeText(path, contents) {
      await runtime.writeFile(path, contents);
    },
    async exists(path) {
      try {
        await runtime.stat(path);
        return true;
      } catch {
        return false;
      }
    },
    async makeDir(path) {
      await runtime.makeDir(path, { recursive: true });
    },
    async remove(path) {
      await runtime.remove(path);
    },
  };
}

