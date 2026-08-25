/**
 * Fetch/verify the pinned txiki.js binary in gitignored vendor/txiki/.
 *
 * `vendor/` is gitignored (see .gitignore), so a clean checkout — or anything
 * that wipes vendor/ — leaves every txiki task dead. This script is the missing
 * setup step: it is what build:txiki depends on.
 *
 *   vendor/txiki/tjs   slim `min` profile — no FFI, no TLS, ~2 MB. This is the
 *                      runtime `tjs compile` embeds in the shipped executable,
 *                      which is why it is the small one. It has no
 *                      `bundle`/`eval`/`serve`/`test`/`app` subcommands (the
 *                      `tjs.serve` *API* is still there, all the capability
 *                      probe needs).
 *
 * There used to be a second binary here, `vendor/txiki/tjs-bundle` — the full
 * upstream build, carried solely for the one `tjs bundle` step the slim build
 * cannot do. It is gone: bundling now runs on the repo's own esbuild devDep
 * (scripts/txiki-bundle.mjs). That was forced rather than chosen — upstream
 * saghul/txiki.js v26.6.0 publishes macos-arm64, macos-x86_64 and
 * windows-x86_64 and *no Linux asset at all*, while `__TJS_BUNDLER__` is
 * compiled out of every slim profile, so no released txiki binary anywhere can
 * bundle on Linux and CI could never have run there.
 *
 * Re-running is a cheap no-op once it is in place: with no --force it only
 * spawns `--version` on what is already there and touches the network solely
 * when the binary is missing or reports the wrong version.
 *
 * Usage: node scripts/vendor-txiki.mjs [--force] [--check]
 *   --check  verify only; never download (exit 1 if something is missing)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { arch, platform } from "node:os";
import { join } from "node:path";
import { TJS_VERSION as VERSION, VENDOR_DIR } from "./txiki-test-util.mjs";

const REPO = "lukasMega/txiki.js-with-slim-builds";
const TAG = "slim-v26.6.0-6";

/**
 * Pinned release assets, by `${platform()}-${arch()}`.
 *
 * A tagged (not rolling) release, so fetching by tag is already stable; the
 * sha256 of the *extracted* binary is pinned on top of that so a re-cut tag or
 * a mangled download is loud rather than silently shipped. Every digest below
 * was computed here from the downloaded zip and independently cross-checked
 * against the release's own SHA256SUMS.txt asset (2026-08-25).
 *
 * ⚠️ Only `darwin-arm64` has ever been **executed** on this machine. The
 * linux-x64 and win32-x64 entries are digest-verified but unrun — they exist so
 * CI can provision through this same pinned code path rather than a second
 * mechanism in YAML, and the first CI run on each is what validates them. Treat
 * a failure there as "the pin was never proven", not as a regression.
 *
 * Not pinned, and not an oversight: **darwin-x64**. The slim release publishes
 * no macOS x86_64 asset in *any* profile (min/ffi/tls/ffi-tls are arm64-only on
 * macOS), so that platform has no source here at all. linux-arm64 exists
 * upstream and could be added the day something needs it.
 */
const PIN = {
  "darwin-arm64": {
    asset: "txiki-slim-min-macos-arm64.zip",
    member: "txiki-slim-min-macos-arm64/tjs",
    sha256: "c4f2497c4f2e09a2707e42edc0daae5e0a1d5a329bbb08ee4a8c5ea8ebaea0d7",
  },
  "linux-x64": {
    asset: "txiki-slim-min-linux-x86_64.zip",
    member: "txiki-slim-min-linux-x86_64/tjs",
    sha256: "8cfcffb8269a5d88858b62d9c255f0c4feb225a5ce3ed84396b5b3499f70419e",
  },
  "win32-x64": {
    asset: "txiki-slim-min-windows-x86_64.zip",
    member: "txiki-slim-min-windows-x86_64/tjs.exe",
    sha256: "a5c8d01246538076d0f479831903b8f92642a7984556a4494fa56df246c0acbf",
  },
};

const force = process.argv.includes("--force");
const checkOnly = process.argv.includes("--check");

// validateTjsVersion() asserts every bin against SHELLINT_TJS_VERSION when set
// and against the same TJS_VERSION pin otherwise; fetching an asset for a
// different version would install a binary the rest of the toolchain rejects.
const envVersion = process.env.SHELLINT_TJS_VERSION?.trim();
if (envVersion && envVersion.replace(/^v/, "") !== VERSION) {
  console.error(`FAIL: SHELLINT_TJS_VERSION is ${envVersion}, this script pins ${VERSION}`);
  console.error("Update TJS_VERSION in scripts/txiki-test-util.mjs (and the PIN digests) or the env var.");
  process.exit(1);
}

const key = `${platform()}-${arch()}`;
const pinned = PIN[key];
if (!pinned) {
  console.error(`FAIL: no pinned txiki.js build for ${key}`);
  console.error(`Pinned platforms: ${Object.keys(PIN).join(", ")}.`);
  console.error("Point SHELLINT_TJS_BIN at your own build,");
  console.error("or add a pin — see the PIN comment in scripts/vendor-txiki.mjs.");
  process.exit(1);
}

// Windows cannot spawn an extensionless binary, and resolveTjsBin() looks for
// `tjs.exe` first on win32 — so the on-disk name has to carry the suffix.
const BIN_NAME = platform() === "win32" ? "tjs.exe" : "tjs";

/** Version string of a binary, or null when it is absent/not runnable. */
function versionOf(bin) {
  try {
    return execFileSync(bin, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .replace(/^v/, "");
  } catch {
    return null;
  }
}

async function fetchAsset(spec) {
  const url = `https://github.com/${REPO}/releases/download/${TAG}/${spec.asset}`;
  console.log(`fetching ${REPO}@${TAG} ${spec.asset}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    console.error(`FAIL: ${res.status} ${res.statusText} fetching ${url}`);
    process.exit(1);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Extract one member out of a zip. Node ships no unzip, and `tar -xf` only
 * reads zip on bsdtar (macOS), not GNU tar (Linux) — `unzip` is the one command
 * present on both.
 */
function extract(zipBytes, member, dest) {
  const work = mkdtempSync(join(tmpdir(), "vendor-txiki-"));
  try {
    const zip = join(work, "asset.zip");
    writeFileSync(zip, zipBytes);
    execFileSync("unzip", ["-o", "-q", zip, member, "-d", work], { stdio: "inherit" });
    copyFileSync(join(work, member), dest);
    chmodSync(dest, 0o755);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function install(spec) {
  const dest = join(VENDOR_DIR, BIN_NAME);
  const bytes = await fetchAsset(spec);
  mkdirSync(VENDOR_DIR, { recursive: true });
  extract(bytes, spec.member, dest);

  const sha256 = createHash("sha256").update(readFileSync(dest)).digest("hex");
  if (sha256 !== spec.sha256) {
    console.error(`FAIL: sha256 mismatch for ${spec.member} (${REPO}@${TAG})`);
    console.error(`  expected ${spec.sha256}`);
    console.error(`  actual   ${sha256}`);
    console.error("GitHub served bytes that are not the pinned build — not installing.");
    rmSync(dest, { force: true });
    process.exit(1);
  }
  const got = versionOf(dest);
  if (got !== VERSION) {
    console.error(`FAIL: ${dest} reports ${got ?? "no version"}, expected ${VERSION}`);
    process.exit(1);
  }
  console.log(`  ${BIN_NAME} ${VERSION} → ${dest}`);
}

const dest = join(VENDOR_DIR, BIN_NAME);
const have = force ? null : versionOf(dest);
if (have === VERSION) {
  console.log(`vendor/txiki/${BIN_NAME} ${have} OK`);
  process.exit(0);
}
if (have) console.log(`vendor/txiki/${BIN_NAME} is ${have}, want ${VERSION} — refetching`);

if (checkOnly) {
  console.error(`FAIL: vendor/txiki/${BIN_NAME} missing or wrong version`);
  console.error("Run: mise run vendor:txiki");
  process.exit(1);
}

await install(pinned);
