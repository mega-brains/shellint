import { defineConfig, devices } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Not 8787: that is the dev server's port, and a dev server serves the user's
// live scripts/main.ts. The suite must only ever talk to a server whose script
// is the fixture workspace below — hence its own port and no server reuse.
const PORT = 8789;
const BASE = `http://127.0.0.1:${PORT}`;
// Static/offline build (M17.8) — a second, independent server with no relation
// to the Hono app above; e2e/static.spec.ts targets it via absolute URLs
// rather than the config's `baseURL`, so it stays this port regardless of
// which spec runs first.
export const STATIC_PORT = 8788;

/**
 * The device script under test: a fresh copy of `fixtures/device/main.ts`,
 * built into its own dist. `scripts/build-fixture.mjs` (first command of the
 * webServer below) creates it; `DEVROOM_SCRIPT`/`DEVROOM_DIST` point the
 * server, its builder and its Check at it. Nothing in the suite reads or
 * writes the user's `scripts/main.ts` — specs save to the editor, and that
 * write lands here.
 */
export const FIXTURE_ENV = {
  DEVROOM_SCRIPT: ".tmp/e2e/main.ts",
  DEVROOM_DIST: ".tmp/e2e/dist",
};
const STATIC_BASE = `http://127.0.0.1:${STATIC_PORT}`;

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 4,
  reporter: [["dot"]],
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 120,
      animations: "disabled",
    },
  },
  use: {
    baseURL: BASE,
    trace: "on-first-retry",
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
  },
  projects: [
    {
      name: "chromium",
      // Default: system Chrome. Set PW_CHANNEL=bundled after
      // `npx playwright install chromium` to use Playwright's browser.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        ...(process.env.PW_CHANNEL === "bundled"
          ? {}
          : { channel: (process.env.PW_CHANNEL as "chrome") || "chrome" }),
      },
    },
  ],
  webServer: [
    {
      // The device build too: a dist/ older than the script trips the
      // `artifacts-stale` check, which expands the inputs group and moves the
      // check panel under the design baselines.
      command:
        "node scripts/build-fixture.mjs e2e && npm run build:web && node --import tsx server/index.ts",
      cwd: ROOT,
      url: BASE,
      env: { ...FIXTURE_ENV, DEVROOM_PORT: String(PORT) },
      // Never reuse: a server already on this port may be pointed at another
      // script, which is exactly the dependency this suite must not have.
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Independent of the server above: build:static's own esbuild config,
      // served by the same plain Node http server `mise run preview:static`
      // uses — proving the static bundle needs nothing server-side.
      command: `npm run build:static && npm run preview:static -- --port ${STATIC_PORT}`,
      cwd: ROOT,
      url: STATIC_BASE,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
