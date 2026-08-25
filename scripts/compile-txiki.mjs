import { chmodSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, runTjs } from "./txiki-test-util.mjs";

const input = join(ROOT, ".txiki", "server.js");
const output = join(
  ROOT,
  ".txiki",
  process.platform === "win32" ? "shellint.exe" : "shellint",
);

// Unlink first, so `tjs compile` writes a *new* inode rather than overwriting
// the old one in place. On macOS the kernel caches the code-signature check per
// inode: rewriting a signed binary at a path that has already been executed
// invalidates it, and the next exec dies from SIGKILL with no output at all —
// `Killed: 9`, exit 137. That is exactly what a rebuild-then-run chain does,
// which is how the txiki e2e webServer starts (`build:txiki:executable &&
// ./.txiki/shellint`). Observed 2026-08-25; the same bytes copied to a fresh
// path ran fine, which is what identified it. Also matters on `macos-latest`
// in CI.
rmSync(output, { force: true });

const result = runTjs(["compile", input, output]);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (process.platform !== "win32") chmodSync(output, 0o755);
console.log(`txiki executable: ${output} (${statSync(output).size} bytes)`);
