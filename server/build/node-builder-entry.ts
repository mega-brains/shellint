import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, assertDevroomCompiler } from "../core/config.ts";
import { DIST_DIR, ROOT } from "../core/paths.ts";
import type {
  BuildOptions,
  BuildOutput,
  BuildSizes,
} from "./builder-backend.ts";

function byteLen(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  return Buffer.byteLength(readFileSync(path));
}

function collectSizes(): BuildSizes {
  const debug: BuildSizes["debug"] = {};
  const prod: BuildSizes["prod"] = {};
  const debugRaw = byteLen(join(DIST_DIR, "debug.raw.js"));
  const prodRaw = byteLen(join(DIST_DIR, "prod.raw.js"));
  const debugMin = byteLen(join(DIST_DIR, "debug.js"));
  const prodMin = byteLen(join(DIST_DIR, "prod.js"));
  const debugAdv = byteLen(join(DIST_DIR, "debug.adv.js"));
  const prodAdv = byteLen(join(DIST_DIR, "prod.adv.js"));
  if (debugRaw != null) debug.raw = debugRaw;
  if (prodRaw != null) prod.raw = prodRaw;
  if (debugMin != null) debug.min = debugMin;
  if (prodMin != null) prod.min = prodMin;
  if (debugAdv != null) debug.adv = debugAdv;
  if (prodAdv != null) prod.adv = prodAdv;
  return { debug, prod };
}

function run(cmd: string, args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      shell: process.platform === "win32",
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: stderr + String(error) });
    });
  });
}

/** Existing Node subprocess builder, selected by default package condition. */
export async function runBuildBackend(
  options: BuildOptions = {},
): Promise<BuildOutput> {
  const config = await loadConfig();
  assertDevroomCompiler(config);

  const packagePath = join(ROOT, "package.json");
  let result: { code: number; stdout: string; stderr: string };
  if (existsSync(packagePath)) {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    if (packageJson.scripts?.["build:shelly"]) {
      result = await run("npm", [
        "run",
        "build:shelly",
        ...(options.skipTypeCheck ? ["--", "--no-typecheck"] : []),
      ]);
    } else if (existsSync(join(ROOT, "scripts", "build-shelly.mjs"))) {
      result = await run("node", [
        "scripts/build-shelly.mjs",
        ...(options.skipTypeCheck ? ["--no-typecheck"] : []),
      ]);
    } else {
      throw new Error(
        "build:shelly script missing — waiting on M1 agent (scripts/build-shelly.mjs / npm run build:shelly)",
      );
    }
  } else if (existsSync(join(ROOT, "scripts", "build-shelly.mjs"))) {
    result = await run("node", [
      "scripts/build-shelly.mjs",
      ...(options.skipTypeCheck ? ["--no-typecheck"] : []),
    ]);
  } else {
    throw new Error(
      "package.json and scripts/build-shelly.mjs missing — waiting on M0/M1 scaffold agent",
    );
  }

  if (result.code !== 0) {
    throw new Error(`build failed (exit ${result.code}):\n${result.stderr || result.stdout}`);
  }

  const jsonMatch = result.stdout.match(/\{[\s\S]*"debug"[\s\S]*"prod"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as BuildSizes;
      if (parsed.debug && parsed.prod) {
        return { sizes: parsed, stdout: result.stdout, stderr: result.stderr };
      }
    } catch {
      // Fall through to artifact sizes.
    }
  }

  const sizes = collectSizes();
  if (sizes.debug.min == null && sizes.prod.min == null) {
    const listing = existsSync(DIST_DIR) ? readdirSync(DIST_DIR).join(", ") : "(no dist/)";
    throw new Error(
      `build finished but no dist artifacts found (looked for debug.js/prod.js). dist/: ${listing}`,
    );
  }
  return { sizes, stdout: result.stdout, stderr: result.stderr };
}
