import { defineConfig, devices } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}`;

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
  webServer: {
    // build:shelly too: a dist/ older than scripts/main.ts trips the
    // `artifacts-stale` check, which expands the inputs group and moves the
    // check panel under the design baselines.
    command:
      "npm run build:shelly && npm run build:web && node --import tsx server/index.ts",
    cwd: ROOT,
    url: BASE,
    // A dev server already on :8787 is reused as-is — including its web bundle.
    // Restart it after touching web/ or the baselines compare against stale UI.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
