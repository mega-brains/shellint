/** Config rename compatibility: primary path, legacy fallback, primary writes. */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../server/core/paths.ts";
import { loadConfig, patchMinifyConfig } from "../server/core/config.ts";
import { loadConfig as loadBuildConfig } from "./build-shelly.mjs";

const primary = join(ROOT, "shellint.json");
const legacy = join(ROOT, "devroom.json");
const savedPrimary = existsSync(primary) ? readFileSync(primary, "utf8") : null;
const savedLegacy = existsSync(legacy) ? readFileSync(legacy, "utf8") : null;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function restore(path, saved) {
  if (saved === null) rmSync(path, { force: true });
  else writeFileSync(path, saved, "utf8");
}

try {
  rmSync(primary, { force: true });
  writeFileSync(legacy, '{"port":9999,"compiler":"devroom"}\n', "utf8");
  if ((await loadConfig()).port !== 9999) fail("server must read legacy config fallback");
  if (loadBuildConfig().port !== 9999) fail("builder must read legacy config fallback");

  writeFileSync(primary, '{"port":8788,"compiler":"shellint"}\n', "utf8");
  if ((await loadConfig()).port !== 8788) fail("server must prefer shellint.json");
  if (loadBuildConfig().port !== 8788) fail("builder must prefer shellint.json");

  await patchMinifyConfig({ advanced: true });
  if (JSON.parse(readFileSync(primary, "utf8")).minify?.advanced !== true) {
    fail("config PATCH must target shellint.json");
  }
} finally {
  restore(primary, savedPrimary);
  restore(legacy, savedLegacy);
}

console.log("OK: config rename paths");
