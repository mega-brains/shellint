/**
 * The gate's stand-in for the user's live device script.
 *
 * Nothing under `npm run test` / `npm run test:e2e` may read or write
 * `scripts/main.ts`: it is the buffer the user is editing, so its size, its
 * lint findings and even whether it compiles are all outside the repo's
 * control. Every gate step instead points `SHELLINT_SCRIPT` / `SHELLINT_DIST`
 * (honoured by `server/core/paths.ts` and `scripts/build-shelly.mjs`) at a
 * scratch copy of `fixtures/device/main.ts` — a copy, not the fixture itself,
 * because tests and the e2e save flow write to it.
 */
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_SCRIPT = path.join(ROOT, "fixtures", "device", "main.ts");

/** Absolute-or-root-relative env override, same rule as the server's. */
function fromEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return path.isAbsolute(raw) ? raw : path.join(ROOT, raw);
}

/** The script the current process builds/checks — fixture copy under the gate. */
export function scriptPath() {
  return fromEnv("SHELLINT_SCRIPT", path.join(ROOT, "scripts", "main.ts"));
}

/** The dist/ the current process reads — a scratch dir under the gate. */
export function distDir() {
  return fromEnv("SHELLINT_DIST", path.join(ROOT, "dist"));
}

/**
 * The tsconfig that produced `distDir()`'s artifacts: the generated one
 * `build-shelly.mjs` wrote next to them, or the committed live-script config.
 */
export function scriptTsconfig() {
  return scriptPath() === path.join(ROOT, "scripts", "main.ts")
    ? path.join(ROOT, "config", "tsconfig.shelly.script.json")
    : path.join(distDir(), ".tsc-out", "tsconfig.json");
}

/**
 * Create `.tmp/<name>/` holding a fresh copy of the fixture, and point this
 * process (and anything it spawns) at it. Call before importing any server
 * module — `server/core/paths.ts` reads the env once, at module load.
 * @param {string} name workspace name, unique per concurrent runner
 * @returns {{ dir: string, script: string, dist: string }}
 */
export function useFixtureWorkspace(name) {
  const dir = path.join(ROOT, ".tmp", name);
  const script = path.join(dir, "main.ts");
  const dist = path.join(dir, "dist");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  copyFileSync(FIXTURE_SCRIPT, script);
  process.env.SHELLINT_SCRIPT = script;
  process.env.SHELLINT_DIST = dist;
  return { dir, script, dist };
}
