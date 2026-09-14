/**
 * README / landing-page hero screenshots — `.github/assets/shellint-header.png`
 * (light) and `shellint-header-dark.png` (dark).
 *
 * Not part of the gate: `e2e/playwright.config.ts` ignores `capture/**`, and
 * this file writes into the repo instead of asserting. Run it with
 * `mise run capture:header` (`pnpm run capture:header`) after a deliberate UI
 * change, then review both PNGs.
 *
 * Both shots come from one helper and one mock set, so the pair only ever
 * differs by theme — the light shot previously came from a session with no
 * `/api/stats` mock, which left its whole sidebar reading "no stats yet"
 * against a fully populated dark one. That helper is
 * `e2e/helpers/settled-app.ts`, shared with `demo.spec.ts` so the dark shot
 * stays the video's exact first frame.
 */
import { test } from "../helpers/test-base";
import { CAPTURE_VIEWPORT, openSettled } from "../helpers/settled-app";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "assets");

test.describe("hero screenshots", () => {
  test.use({ viewport: CAPTURE_VIEWPORT });

  for (const [theme, file] of [
    ["light", "shellint-header.png"],
    ["dark", "shellint-header-dark.png"],
  ] as const) {
    test(`${theme} theme`, { tag: "@layout" }, async ({ page }) => {
      await openSettled(page, theme);
      await page.screenshot({ path: join(ASSETS, file), animations: "disabled" });
    });
  }
});
