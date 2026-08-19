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

// Windows: only `.exe`, deliberately. `.cmd`/`.bat` wrappers cannot be
// launched by `spawnSync` without `shell: true` (Node ≥18.20 rejects them with
// EINVAL), so listing them here would only trade a clear "not executable" for
// an opaque spawn failure. txiki.js ships `tjs.exe`.
const EXE_SUFFIXES = process.platform === "win32" ? [".exe", ""] : [""];

function withSuffixes(path) {
  return EXE_SUFFIXES.map((suffix) => path + suffix);
}

function pathCandidates(name) {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return dirs.flatMap((dir) => withSuffixes(join(dir, name)));
}

export function resolveTjsBin(envVar = "SHELLINT_TJS_BIN") {
  const override = process.env[envVar]?.trim();
  if (override) {
    // A path-shaped override still needs the platform suffix: the checked-in
    // default (`../../txiki.js/build/tjs`) names the POSIX binary, and the
    // Windows build of the same tree is `tjs.exe`.
    const candidates = isAbsolute(override)
      ? withSuffixes(override)
      : override.includes("/") || override.includes("\\")
        ? withSuffixes(resolve(ROOT, override))
        : pathCandidates(override);
    const found = candidates.find(executable);
    if (found) return found;
    throw new Error(`${envVar} is not executable: ${override}`);
  }

  if (envVar !== "SHELLINT_TJS_BIN") return resolveTjsBin();

  const found = pathCandidates("tjs").find(executable);
  if (found) return found;
  throw new Error(
    "txiki.js executable missing; set SHELLINT_TJS_BIN or add tjs to PATH",
  );
}

// Size-optimized tjs builds may drop the esbuild-backed `bundle` subcommand.
// SHELLINT_TJS_BUNDLE_BIN lets bundling use full-featured build while
// SHELLINT_TJS_BIN stays slim one shipped as final executable.
export function resolveTjsBundleBin() {
  return process.env.SHELLINT_TJS_BUNDLE_BIN
    ? resolveTjsBin("SHELLINT_TJS_BUNDLE_BIN")
    : resolveTjsBin();
}

function validateTjsVersion(bin) {
  const expected = process.env.SHELLINT_TJS_VERSION?.trim();
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

export function runTjs(args, { bin: binOverride, ...options } = {}) {
  const bin = binOverride ?? resolveTjsBin();
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
