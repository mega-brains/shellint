/**
 * Fetch/verify the two pinned txiki.js binaries in gitignored vendor/txiki/.
 *
 * `vendor/` is gitignored (see .gitignore) and mise.toml pins both binaries by
 * repo-relative path, so a clean checkout — or anything that wipes vendor/ —
 * leaves every txiki task dead with
 *   "SHELLINT_TJS_BUNDLE_BIN is not executable: vendor/txiki/tjs-bundle".
 * This script is the missing setup step: it is what build:txiki depends on.
 *
 * Two different builds are needed, both v26.6.0 (see mise.toml [env]):
 *   vendor/txiki/tjs         slim `min` profile — no FFI, no TLS, ~2 MB. This
 *                            is the runtime `tjs compile` embeds in the shipped
 *                            executable, which is why it is the small one. It
 *                            has no `bundle`/`eval`/`serve`/`test`/`app`
 *                            subcommands (the `tjs.serve` *API* is still there,
 *                            all the capability probe needs).
 *   vendor/txiki/tjs-bundle  full upstream build, for the one `tjs bundle`
 *                            (esbuild) step the slim build cannot do.
 *
 * Re-running is a cheap no-op once both are in place: with no --force it only
 * spawns `--version` on what is already there and touches the network solely
 * when a binary is missing or reports the wrong version.
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
import { ROOT } from "./txiki-test-util.mjs";

const VENDOR_DIR = join(ROOT, "vendor", "txiki");
const VERSION = "26.6.0";

/**
 * Pinned release assets, by `${platform()}-${arch()}`.
 *
 * Both are tagged (not rolling) releases, so fetching by tag is already stable;
 * the sha256 of the *extracted* binary is pinned on top of that so a re-cut tag
 * or a mangled download is loud rather than silently shipped.
 *
 * darwin-arm64 only, deliberately. The slim release also publishes linux
 * x86_64/arm64 and windows x86_64, but upstream saghul/txiki.js v26.6.0
 * publishes macos-arm64, macos-x86_64 and windows-x86_64 *only* — there is no
 * upstream Linux asset, so the bundler half of the pair has no source there and
 * a Linux entry would be half a pin. macOS x64 and Windows have both halves
 * available but have never been run here; adding them is a deliberate act:
 * download the assets, verify, run `mise run test:txiki`, then pin the digests.
 */
const PIN = {
  "darwin-arm64": {
    tjs: {
      repo: "lukasMega/txiki.js-with-slim-builds",
      tag: "slim-v26.6.0-6",
      asset: "txiki-slim-min-macos-arm64.zip",
      member: "txiki-slim-min-macos-arm64/tjs",
      sha256: "c4f2497c4f2e09a2707e42edc0daae5e0a1d5a329bbb08ee4a8c5ea8ebaea0d7",
    },
    "tjs-bundle": {
      repo: "saghul/txiki.js",
      tag: "v26.6.0",
      asset: "txiki-macos-arm64.zip",
      member: "txiki-macos-arm64/tjs",
      sha256: "b7c97823d6f64fcf06f343caaa238376da637c9d4b666154d0d120cbad1f02a2",
    },
  },
};

const force = process.argv.includes("--force");
const checkOnly = process.argv.includes("--check");

// mise.toml's SHELLINT_TJS_VERSION is what validateTjsVersion() asserts every
// bin against; pinning assets for a different version here would fetch two
// binaries the rest of the toolchain then rejects.
const envVersion = process.env.SHELLINT_TJS_VERSION?.trim();
if (envVersion && envVersion.replace(/^v/, "") !== VERSION) {
  console.error(`FAIL: SHELLINT_TJS_VERSION is ${envVersion}, this script pins ${VERSION}`);
  console.error("Update PIN in scripts/vendor-txiki.mjs (digests included) or the env var.");
  process.exit(1);
}

const key = `${platform()}-${arch()}`;
const pinned = PIN[key];
if (!pinned) {
  console.error(`FAIL: no pinned txiki.js pair for ${key}`);
  console.error(`Pinned platforms: ${Object.keys(PIN).join(", ")}.`);
  console.error("Point SHELLINT_TJS_BIN / SHELLINT_TJS_BUNDLE_BIN at your own builds,");
  console.error("or add a pin — see the PIN comment in scripts/vendor-txiki.mjs.");
  process.exit(1);
}

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

/**
 * The slim build has no `bundle` subcommand; the full one must.
 *
 * Read it off the top-level `--help` subcommand list, not by running
 * `bundle --help`: the full build exits 1 from that (it is a usage error, the
 * subcommand wants an infile) while the slim build silently falls back to the
 * top-level help and exits 0 — i.e. exactly backwards.
 */
function hasBundle(bin) {
  try {
    const help = execFileSync(bin, ["--help"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /^\s+bundle\b/m.test(help);
  } catch {
    return false;
  }
}

async function fetchAsset(spec) {
  const url = `https://github.com/${spec.repo}/releases/download/${spec.tag}/${spec.asset}`;
  console.log(`fetching ${spec.repo}@${spec.tag} ${spec.asset}`);
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

async function install(name, spec) {
  const dest = join(VENDOR_DIR, name);
  const bytes = await fetchAsset(spec);
  mkdirSync(VENDOR_DIR, { recursive: true });
  extract(bytes, spec.member, dest);

  const sha256 = createHash("sha256").update(readFileSync(dest)).digest("hex");
  if (sha256 !== spec.sha256) {
    console.error(`FAIL: sha256 mismatch for ${spec.member} (${spec.repo}@${spec.tag})`);
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
  console.log(`  ${name} ${VERSION} → ${dest}`);
}

const missing = [];
for (const name of Object.keys(pinned)) {
  const dest = join(VENDOR_DIR, name);
  const have = force ? null : versionOf(dest);
  if (have === VERSION) {
    // The whole point of the pair is that one can bundle and one cannot; a
    // vendor dir where both copies are the slim build fails much later, inside
    // `tjs bundle`, with a bare usage error.
    if (name === "tjs-bundle" && !hasBundle(dest)) {
      console.log(`vendor/txiki/${name} has no \`bundle\` subcommand — refetching`);
    } else {
      console.log(`vendor/txiki/${name} ${have} OK`);
      continue;
    }
  } else if (have) {
    console.log(`vendor/txiki/${name} is ${have}, want ${VERSION} — refetching`);
  }
  missing.push(name);
}

if (!missing.length) process.exit(0);

if (checkOnly) {
  console.error(`FAIL: vendor/txiki/{${missing.join(",")}} missing or wrong version`);
  console.error("Run: mise run vendor:txiki");
  process.exit(1);
}

for (const name of missing) await install(name, pinned[name]);
