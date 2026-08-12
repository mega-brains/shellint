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
  workers: 1,
  reporter: [["list"]],
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
    command: "npm run build:web && node --import tsx server/index.ts",
    cwd: ROOT,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
