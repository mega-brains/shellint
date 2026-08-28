/**
 * Which Chromium the e2e suites drive.
 *
 * Playwright's bundled headless shell runs the suites ~40% faster than system
 * Chrome, but `playwright install` needs Google's CDN, which fails behind a
 * TLS-inspecting proxy — so it is used when present and Chrome is the fallback.
 * `PW_CHANNEL` overrides: `bundled`, or any channel name.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function registryDir(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "ms-playwright");
  }
  if (process.platform === "win32") {
    return join(
      process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
      "ms-playwright",
    );
  }
  return join(homedir(), ".cache", "ms-playwright");
}

/**
 * Reads the registry directory rather than `chromium.executablePath()`, which
 * resolves the full Chromium download and misses a headless-shell-only cache.
 */
function bundledShellInstalled(): boolean {
  const dir = registryDir();
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((entry) =>
      entry.startsWith("chromium_headless_shell-"),
    );
  } catch {
    return false;
  }
}

/** Spread into a project's `use`. Empty = bundled Chromium. */
export function chromiumChannel(): { channel?: "chrome" } {
  const requested = process.env.PW_CHANNEL;
  if (requested === "bundled") return {};
  if (requested) return { channel: requested as "chrome" };
  return bundledShellInstalled() ? {} : { channel: "chrome" };
}
