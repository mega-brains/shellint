import { chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, runTjs } from "./txiki-test-util.mjs";

const input = join(ROOT, ".txiki", "server.js");
const output = join(
  ROOT,
  ".txiki",
  process.platform === "win32" ? "shelly-devroom.exe" : "shelly-devroom",
);

const result = runTjs(["compile", input, output]);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (process.platform !== "win32") chmodSync(output, 0o755);
console.log(`txiki executable: ${output} (${statSync(output).size} bytes)`);
