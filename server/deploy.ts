import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DIST_DIR } from "./paths.ts";
import { loadConfig, assertDevroomCompiler } from "./config.ts";
import { AuthNotSupportedError, ShellyRpc, RpcError } from "./rpc.ts";

const CHUNK_SIZE = 1024;

export type DeployMode = "debug" | "prod";
export type DeployMinify = "min" | "raw";

export type DeployResult = {
  mode: DeployMode;
  minify: DeployMinify;
  artifact: string;
  scriptId: number;
  localBytes: number;
  deviceLen: number | null;
  status: "running";
};

export type DeployProgress = (msg: string) => void;

function artifactPath(mode: DeployMode, minify: DeployMinify): string {
  return minify === "raw"
    ? join(DIST_DIR, `${mode}.raw.js`)
    : join(DIST_DIR, `${mode}.js`);
}

/**
 * ALLTERCO put_script.py pattern over WS:
 * stop → PutCode 1024-byte chunks (append after first) → start.
 * Overwrites fixed scriptId only — never Script.Create.
 */
export async function deploy(
  mode: DeployMode,
  onProgress: DeployProgress = () => {},
  minify: DeployMinify = "min",
): Promise<DeployResult> {
  const cfg = loadConfig();
  assertDevroomCompiler(cfg);

  if (mode !== "debug" && mode !== "prod") {
    throw new Error(`invalid mode "${mode}" — use "debug" or "prod"`);
  }
  if (minify !== "min" && minify !== "raw") {
    throw new Error(`invalid minify "${minify}" — use "min" or "raw"`);
  }

  const path = artifactPath(mode, minify);
  if (!existsSync(path)) {
    throw new Error(`missing build artifact ${path} — run Build first`);
  }

  const code = readFileSync(path, "utf8");
  const localBytes = Buffer.byteLength(code, "utf8");
  const scriptId = cfg.scriptId;

  const rpc = new ShellyRpc(cfg.deviceIp);
  try {
    onProgress("connecting");
    await rpc.connect();

    onProgress("stopped");
    try {
      await rpc.call("Script.Stop", { id: scriptId });
    } catch (e) {
      // Already stopped is fine on some firmwares.
      if (!(e instanceof RpcError)) throw e;
    }

    // Match put_script.py: slice by character count (ASCII JS ≈ bytes).
    onProgress("uploading");
    let deviceLen: number | null = null;
    let append = false;
    let pos = 0;
    while (pos < code.length) {
      const chunk = code.slice(pos, pos + CHUNK_SIZE);
      const result = (await rpc.call("Script.PutCode", {
        id: scriptId,
        code: chunk,
        append,
      })) as { len?: number } | null;
      if (result && typeof result.len === "number") {
        deviceLen = result.len;
      }
      pos += chunk.length;
      append = true;
      onProgress(`uploading ${pos}/${code.length}`);
    }

    if (deviceLen != null && deviceLen !== localBytes) {
      onProgress(`warning: device len ${deviceLen} ≠ local ${localBytes}`);
    }

    onProgress("starting");
    await rpc.call("Script.Start", { id: scriptId });
    onProgress("running");

    return {
      mode,
      minify,
      artifact: path,
      scriptId,
      localBytes,
      deviceLen,
      status: "running",
    };
  } finally {
    rpc.close();
  }
}

export { AuthNotSupportedError };
