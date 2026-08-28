/**
 * The three typechecks, concurrently: they share no program and no output, so
 * serial runs just add three tsc cold starts (~12 s against ~3.5 s). `mise run
 * typecheck` already fans out through `depends`; this is the npm chain's
 * equivalent, which is what CI runs.
 *
 * Output is buffered per project so failing compilers cannot interleave.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Local binary, not a PATH lookup: `.bin` is only on PATH under npm.
const TSC = join(
  ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsc.cmd" : "tsc",
);

/** Mirrors the `typecheck:*` scripts in package.json. */
const PROJECTS = [
  { name: "shelly", args: ["-p", "config/tsconfig.shelly.fixture.json", "--noEmit"] },
  { name: "server", args: ["-p", "config/tsconfig.server.json"] },
  { name: "web", args: ["-p", "config/tsconfig.web.json"] },
];

const results = await Promise.all(
  PROJECTS.map(
    ({ name, args }) =>
      new Promise((resolve) => {
        const child = spawn(TSC, args, {
          cwd: ROOT,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (out += d));
        child.on("error", (err) => resolve({ name, code: 1, out: `${err.message}\n` }));
        child.on("close", (code) => resolve({ name, code: code ?? 1, out }));
      }),
  ),
);

let failed = 0;
for (const { name, code, out } of results) {
  if (out.trim()) console.log(`--- typecheck:${name} ---\n${out.trimEnd()}`);
  if (code !== 0) {
    failed = code;
    console.error(`typecheck:${name} failed (exit ${code})`);
  }
}
process.exit(failed);
