/**
 * Tier-3 ("advanced") minifier: EspruinoTools' own Esprima minifier, via the
 * `espruino` CLI. Chosen over Closure because it is the minifier the Espruino
 * runtime ships with, and it needs no network.
 *
 * `-m` pins MINIFICATION_LEVEL=ESPRIMA (offline); `-n` stops the CLI from
 * opening a serial/BLE/TCP connection; `-o` writes the result instead of
 * uploading it. Failure is always reported, never thrown: the build must
 * degrade to "no tier-3 number" if this engine is unavailable or misbehaves.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const ENGINE = "espruino-esprima";
const DEFAULT_BIN = path.join(root, "node_modules", "espruino", "bin", "espruino-cli.js");
const TIMEOUT_MS = 15000;

/** The CLI drops all comments, so `@meta` blocks are re-attached verbatim. */
const META_COMMENT = /\/\*(?:[^*]|\*(?!\/))*@meta(?:[^*]|\*(?!\/))*\*\//g;

/** Terser is only used as a parser here — broken output must not reach a device. */
async function parses(code) {
  try {
    await minify(code, { compress: false, mangle: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} code
 * @param {{bin?: string}} [options] `bin` overrides the espruino CLI path (tests).
 * @returns {Promise<{ok: true, code: string, engine: string} | {ok: false, reason: string}>}
 */
export async function minifyAdvanced(code, options = {}) {
  const bin = options.bin ?? DEFAULT_BIN;
  if (!existsSync(bin)) {
    return { ok: false, reason: "espruino not installed" };
  }

  const dir = mkdtempSync(path.join(tmpdir(), "devroom-tier3-"));
  const inPath = path.join(dir, "in.js");
  const outPath = path.join(dir, "out.js");
  try {
    writeFileSync(inPath, code, "utf8");
    const run = spawnSync(
      process.execPath,
      [bin, "-n", "-m", "-q", "--no-ble", "-o", outPath, inPath],
      { cwd: dir, encoding: "utf8", timeout: TIMEOUT_MS },
    );

    if (run.error?.code === "ETIMEDOUT" || run.signal) {
      return { ok: false, reason: `espruino timed out after ${TIMEOUT_MS} ms` };
    }
    if (run.error) {
      return { ok: false, reason: `espruino failed to start: ${run.error.message}` };
    }
    if (run.status !== 0) {
      return { ok: false, reason: `espruino exited ${run.status}` };
    }

    // The CLI reports a parse failure on stdout and then passes the source
    // through unchanged, still exiting 0 — so the log has to be inspected.
    const log = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    if (/Error parsing JavaScript/.test(log)) {
      return { ok: false, reason: "espruino could not parse the input" };
    }
    if (!existsSync(outPath)) {
      return { ok: false, reason: "espruino wrote no output" };
    }

    let out = readFileSync(outPath, "utf8");
    if (!out.trim()) {
      return { ok: false, reason: "espruino produced empty output" };
    }

    const meta = code.match(META_COMMENT);
    if (meta) {
      const missing = meta.filter((c) => !out.includes(c));
      if (missing.length > 0) out = `${missing.join("\n")}\n${out}`;
    }

    if (!(await parses(out))) {
      return { ok: false, reason: "espruino output does not parse" };
    }
    return { ok: true, code: out, engine: ENGINE };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
