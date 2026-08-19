/**
 * Fetch the pinned Lightpanda browser binary into .tools/lightpanda.
 *
 * Lightpanda ships no npm package and no versioned macOS/Linux tarball — the
 * `nightly` release holds one bare executable per platform, so this is a
 * download + chmod, not an unpack. Re-running is a no-op once the pinned build
 * is in place.
 *
 * Usage: node scripts/install-lightpanda.mjs [--force]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { arch, platform } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".tools");
export const LIGHTPANDA_BIN = join(outDir, "lightpanda");

/**
 * The one place the browser version lives.
 *
 * `nightly` is a rolling tag — upstream deletes and re-uploads its assets every
 * night, so /releases/download/nightly/<name> quietly serves a different
 * browser from one day to the next. That is not a hypothetical: between builds
 * .8688 and .8737 upstream introduced a synthetic `TID-STARTUP` CDP target that
 * makes every `page.goto` stall for the full timeout unless the harness opens
 * its own page (e2e/helpers/test-base.ts does). There is no usable tag to pin
 * instead; the newest tagged release, 0.3.7, is far older than this.
 *
 * Each re-upload gets a fresh numeric asset id, so fetching *by id* pins the
 * bytes: once upstream rolls the nightly the id stops existing and this fails
 * with a 404 rather than installing something nobody has run. The sha256 and
 * the version string are checked on top of that, so a mismatch is loud wherever
 * it comes from.
 *
 * Bumping these is a deliberate act — re-test first, see failedPin() below.
 * Source: gh api repos/lightpanda-io/browser/releases/tags/nightly
 */
const PIN = {
  version: "1.0.0-nightly.8737+6acfc0357",
  /** Asset ids and digests as published 2026-08-19T02:46Z. */
  assets: {
    "darwin-arm64": {
      name: "lightpanda-aarch64-macos",
      id: 520292345,
      sha256: "539d97a86809f311b35d21be7ff17cce74104edfa33b1a3483ebdb473c18fa61",
    },
    "linux-arm64": {
      name: "lightpanda-aarch64-linux",
      id: 520294963,
      sha256: "23ef9cd64ace1ba273093dc678849223c0d4210550eb70c35ad552e3efaa715d",
    },
    "linux-x64": {
      name: "lightpanda-x86_64-linux",
      id: 520295555,
      sha256: "57f60be035ac49f3232fe03a694299a928a06ea4ce075ca911d52ec7176930a0",
    },
  },
};

/** What every pin failure has to tell the reader to do. */
function failedPin(why) {
  return [
    `${why}.`,
    "",
    "The pin is deliberate. Re-test against the new nightly before moving it:",
    "  npm run test:e2e:lightpanda",
    "  node scripts/lightpanda-probe.mjs",
    "then update PIN in scripts/install-lightpanda.mjs with the id, digest and",
    "version from:",
    "  gh api repos/lightpanda-io/browser/releases/tags/nightly",
  ].join("\n");
}

const key = `${platform()}-${arch()}`;
const pinned = PIN.assets[key];
if (!pinned) {
  // Upstream publishes no Windows build at all. It does publish
  // lightpanda-x86_64-macos, but this harness was never evaluated on it, so it
  // is left unpinned rather than pinned untested.
  console.error(`FAIL: no pinned Lightpanda build for ${key}`);
  console.error(`Pinned platforms: ${Object.keys(PIN.assets).join(", ")}.`);
  process.exit(1);
}

/** `lightpanda version` is a subcommand; there is no --version flag. */
function installedVersion() {
  try {
    return execFileSync(LIGHTPANDA_BIN, ["version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

if (existsSync(LIGHTPANDA_BIN) && !process.argv.includes("--force")) {
  const have = installedVersion();
  if (have === PIN.version) {
    console.log(`lightpanda ${have} already at ${LIGHTPANDA_BIN}`);
    process.exit(0);
  }
  // Refetch rather than accept it: a binary left over from before the pin, or
  // from an older one, is the exact thing pinning exists to stop us running.
  console.log(
    `cached lightpanda is ${have ?? "not runnable"}, want ${PIN.version} — refetching`,
  );
}

const url = `https://api.github.com/repos/lightpanda-io/browser/releases/assets/${pinned.id}`;
console.log(`fetching ${pinned.name} ${PIN.version} (asset ${pinned.id})`);
const res = await fetch(url, {
  redirect: "follow",
  headers: { accept: "application/octet-stream" },
});
if (!res.ok) {
  console.error(`FAIL: ${res.status} ${res.statusText} fetching ${url}`);
  if (res.status === 404) {
    console.error(failedPin("the pinned asset id is gone — upstream rolled the nightly"));
  }
  process.exit(1);
}

const bytes = Buffer.from(await res.arrayBuffer());
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== pinned.sha256) {
  console.error(`FAIL: sha256 mismatch for ${pinned.name} (asset ${pinned.id})`);
  console.error(`  expected ${pinned.sha256}`);
  console.error(`  actual   ${sha256}`);
  console.error(failedPin("GitHub served bytes that are not the pinned build"));
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(LIGHTPANDA_BIN, bytes);
chmodSync(LIGHTPANDA_BIN, 0o755);

const got = installedVersion();
if (got !== PIN.version) {
  console.error(`FAIL: ${LIGHTPANDA_BIN} reports ${got ?? "no version"}`);
  console.error(`  expected ${PIN.version}`);
  console.error(failedPin("the downloaded binary does not identify as the pinned build"));
  process.exit(1);
}
console.log(`lightpanda ${PIN.version} → ${LIGHTPANDA_BIN}`);
