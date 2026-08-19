/** Missing default gets starter; existing and overridden paths remain untouched. */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMainScript } from "../server/core/ensure-main-script.ts";

const dir = mkdtempSync(join(tmpdir(), "shellint-ensure-main-"));
const missing = join(dir, "missing", "main.ts");
const existing = join(dir, "existing.ts");
const overridden = join(dir, "override.ts");
const template = readFileSync("templates/main.example.ts", "utf8");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!(await ensureMainScript({ scriptPath: missing, overridden: false }))) {
  fail("missing default must create starter");
}
if (readFileSync(missing, "utf8") !== template) fail("starter must match template");

writeFileSync(existing, "existing", "utf8");
if (await ensureMainScript({ scriptPath: existing, overridden: false })) {
  fail("existing script must remain untouched");
}
if (readFileSync(existing, "utf8") !== "existing") fail("existing script changed");

if (await ensureMainScript({ scriptPath: overridden, overridden: true })) {
  fail("overridden script must not receive starter");
}
if (existsSync(overridden)) fail("override path received starter");

console.log("OK: main script bootstrap");
