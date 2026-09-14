/**
 * Runner for `e2e/capture/anim.spec.ts` — the composed product video's frames.
 *
 * A config of its own rather than `playwright.capture.config.ts`, because the
 * subject is a self-contained HTML file loaded over `file://`: the two servers
 * the base config starts (the app on 8789, the static bundle on 8788, a full
 * `build:static` among them) are minutes of work this capture never touches.
 *
 * Kept out of `mise run beforeCommit` the same way the other capture specs are
 * — a run writes ~1350 PNGs into `.tmp/` and, through the encoder that follows
 * it, tracked media.
 */
import { defineConfig, devices } from "@playwright/test";
import { chromiumChannel } from "./helpers/browser-channel.ts";

export default defineConfig({
  testDir: "./capture",
  testMatch: "anim.spec.ts",
  reporter: [["list"]],
  workers: 1,
  fullyParallel: false,
  // The spec sets its own (~30 min for the frame loop); this only covers setup.
  timeout: 60_000,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...chromiumChannel() },
    },
  ],
});
