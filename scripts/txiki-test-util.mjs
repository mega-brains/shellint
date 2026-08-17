import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let checkedVersionKey = null;

function executable(path) {
  if (!existsSync(path)) return false;
  try {
    accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathCandidates(name) {
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return dirs.flatMap((dir) => suffixes.map((suffix) => join(dir, name + suffix)));
}

export function resolveTjsBin() {
  const override = process.env.DEVROOM_TJS_BIN?.trim();
  if (override) {
    const candidates = isAbsolute(override)
      ? [override]
      : override.includes("/") || override.includes("\\")
        ? [resolve(ROOT, override)]
        : pathCandidates(override);
    const found = candidates.find(executable);
    if (found) return found;
    throw new Error(`DEVROOM_TJS_BIN is not executable: ${override}`);
  }

  const found = pathCandidates("tjs").find(executable);
  if (found) return found;
  throw new Error(
    "txiki.js executable missing; set DEVROOM_TJS_BIN or add tjs to PATH",
  );
}

function validateTjsVersion(bin) {
  const expected = process.env.DEVROOM_TJS_VERSION?.trim();
  if (!expected) return;
  const key = `${bin}\0${expected}`;
  if (checkedVersionKey === key) return;
  const result = spawnSync(bin, ["--version"], { encoding: "utf8" });
  if (result.error) throw result.error;
  const actual = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0 || actual.replace(/^v/, "") !== expected.replace(/^v/, "")) {
    throw new Error(
      `txiki.js version mismatch: expected ${expected}, got ${actual || "unknown"} (${bin})`,
    );
  }
  checkedVersionKey = key;
}

export function runTjs(args, options = {}) {
  const bin = resolveTjsBin();
  validateTjsVersion(bin);
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`${bin} ${args.join(" ")} exited ${result.status}\n${output}`);
  }
  return result;
}
