import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, DIST_DIR } from "./paths.ts";
import { loadConfig, assertDevroomCompiler } from "./config.ts";

export type SizePair = {
  raw?: number;
  min?: number;
};

export type BuildSizes = {
  debug: SizePair;
  prod: SizePair;
};

function byteLen(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  return Buffer.byteLength(readFileSync(path));
}

function collectSizes(): BuildSizes {
  // Per-mode: *.raw.js = meta.env DCE only; *.js = minified.
  const debug: SizePair = {};
  const prod: SizePair = {};
  const debugRaw = byteLen(join(DIST_DIR, "debug.raw.js"));
  const prodRaw = byteLen(join(DIST_DIR, "prod.raw.js"));
  const debugMin = byteLen(join(DIST_DIR, "debug.js"));
  const prodMin = byteLen(join(DIST_DIR, "prod.js"));
  if (debugRaw != null) debug.raw = debugRaw;
  if (prodRaw != null) prod.raw = prodRaw;
  if (debugMin != null) debug.min = debugMin;
  if (prodMin != null) prod.min = prodMin;
  return { debug, prod };
}

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      shell: process.platform === "win32",
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: stderr + String(err) });
    });
  });
}

/**
 * Run dual debug/prod build via npm run build:shelly (or scripts/build-shelly.mjs fallback).
 */
export async function runBuild(): Promise<{
  sizes: BuildSizes;
  stdout: string;
  stderr: string;
}> {
  const cfg = loadConfig();
  assertDevroomCompiler(cfg);

  const pkgPath = join(ROOT, "package.json");
  let result: { code: number; stdout: string; stderr: string };

  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    if (pkg.scripts?.["build:shelly"]) {
      result = await run("npm", ["run", "build:shelly"]);
    } else if (existsSync(join(ROOT, "scripts", "build-shelly.mjs"))) {
      result = await run("node", ["scripts/build-shelly.mjs"]);
    } else {
      throw new Error(
        "build:shelly script missing — waiting on M1 agent (scripts/build-shelly.mjs / npm run build:shelly)",
      );
    }
  } else if (existsSync(join(ROOT, "scripts", "build-shelly.mjs"))) {
    result = await run("node", ["scripts/build-shelly.mjs"]);
  } else {
    throw new Error(
      "package.json and scripts/build-shelly.mjs missing — waiting on M0/M1 scaffold agent",
    );
  }

  if (result.code !== 0) {
    throw new Error(
      `build failed (exit ${result.code}):\n${result.stderr || result.stdout}`,
    );
  }

  // Prefer JSON size summary on stdout if build prints one.
  const jsonMatch = result.stdout.match(/\{[\s\S]*"debug"[\s\S]*"prod"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as BuildSizes;
      if (parsed.debug && parsed.prod) {
        return { sizes: parsed, stdout: result.stdout, stderr: result.stderr };
      }
    } catch {
      /* fall through to file sizes */
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
