/**
 * Fetch the Lightpanda browser binary into .tools/lightpanda.
 *
 * Lightpanda ships no npm package and no versioned macOS/Linux tarball — the
 * `nightly` release holds one bare executable per platform, so this is a
 * download + chmod, not an unpack. Re-running is a no-op unless --force.
 *
 * Usage: node scripts/install-lightpanda.mjs [--force]
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { arch, platform } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".tools");
export const LIGHTPANDA_BIN = join(outDir, "lightpanda");

const ASSETS = {
  "darwin-arm64": "lightpanda-aarch64-macos",
  "linux-arm64": "lightpanda-aarch64-linux",
  "linux-x64": "lightpanda-x86_64-linux",
};

const key = `${platform()}-${arch()}`;
const asset = ASSETS[key];
if (!asset) {
  // No x86_64-macos build is published, and there is no Windows build at all.
  console.error(`FAIL: Lightpanda publishes no binary for ${key}`);
  process.exit(1);
}

if (existsSync(LIGHTPANDA_BIN) && !process.argv.includes("--force")) {
  console.log(`lightpanda already at ${LIGHTPANDA_BIN} (--force to refetch)`);
  process.exit(0);
}

const url = `https://github.com/lightpanda-io/browser/releases/download/nightly/${asset}`;
console.log(`fetching ${url}`);
const res = await fetch(url, { redirect: "follow" });
if (!res.ok) {
  console.error(`FAIL: ${res.status} ${res.statusText}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(LIGHTPANDA_BIN, Buffer.from(await res.arrayBuffer()));
chmodSync(LIGHTPANDA_BIN, 0o755);
console.log(`lightpanda → ${LIGHTPANDA_BIN}`);
