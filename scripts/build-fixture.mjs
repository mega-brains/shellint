#!/usr/bin/env node
/**
 * `build:shelly`, but over the fixture workspace instead of the user's live
 * `scripts/main.ts` — the device-build step of the pre-commit gate and of the
 * e2e servers. Prints the workspace it used, then whatever build-shelly.mjs
 * prints. Extra CLI args are forwarded (e.g. `--no-typecheck`).
 *
 * Usage: node scripts/build-fixture.mjs [name] [-- build-shelly args]
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT, useFixtureWorkspace } from "./fixture-workspace.mjs";

const argv = process.argv.slice(2);
const name = argv[0] && !argv[0].startsWith("-") ? argv[0] : "gate";
const forwarded = argv.filter((a) => a.startsWith("-"));

const { script, dist } = useFixtureWorkspace(name);
console.log(
  `fixture build: ${path.relative(ROOT, script)} → ${path.relative(ROOT, dist)}/`,
);

const result = spawnSync(
  process.execPath,
  [path.join(ROOT, "scripts", "build-shelly.mjs"), ...forwarded],
  { cwd: ROOT, stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
