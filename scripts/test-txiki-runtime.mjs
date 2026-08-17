import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./txiki-test-util.mjs";

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${process.execPath} ${args.join(" ")} exited ${result.status}`);
  }
}

run([join(ROOT, "scripts", "test-txiki-capabilities.mjs")]);
run([join(ROOT, "scripts", "test-txiki-conditions.mjs")]);
run([join(ROOT, "scripts", "build-txiki.mjs")]);
run([
  join(ROOT, "scripts", "test-txiki-bundle-leakage.mjs"),
  join(ROOT, ".txiki", "server.js"),
]);

const reports = mkdtempSync(join(tmpdir(), "devroom-runtime-smoke-"));
try {
  const nodeReport = join(reports, "node.json");
  run([
    join(ROOT, "scripts", "test-runtime-http-smoke.mjs"),
    "--runtime",
    "node",
    "--report",
    nodeReport,
  ]);
  run([
    join(ROOT, "scripts", "test-runtime-http-smoke.mjs"),
    "--runtime",
    "txiki",
    "--bundle",
    join(ROOT, ".txiki", "server.js"),
    "--compare",
    nodeReport,
  ]);
} finally {
  rmSync(reports, { recursive: true, force: true });
}

console.log("txiki runtime parity ok");
