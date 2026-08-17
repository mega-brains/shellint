// Cross-platform `mise run clean` — `rm -rf` is not available under the
// default Windows shell.
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = ["dist", join("web", "dist"), ".tsc-out"];

for (const target of targets) {
  rmSync(join(root, target), { recursive: true, force: true });
  console.log(`removed ${target}`);
}
