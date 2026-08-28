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
 * against a fully populated dark one.
 */
import { expect, test, type Page } from "../helpers/test-base";
import { mockBuildApis, mockDeviceApis } from "../helpers/mock-api";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "assets");

/** Same size as the committed images; the hero is a viewport shot, not fullPage. */
const VIEWPORT = { width: 1620, height: 908 };

/** See design.spec.ts — macOS classic vs overlay scrollbars reflow `#side`. */
const PIN_SCROLLBARS = `
*::-webkit-scrollbar { width: 0; height: 0; }
*::-webkit-scrollbar-thumb, *::-webkit-scrollbar-track { background: transparent; }
`;

async function openSettled(page: Page, theme: "dark" | "light") {
  await mockDeviceApis(page);
  await mockBuildApis(page);
  await page.addInitScript((t) => {
    localStorage.clear();
    localStorage.setItem("shellint.theme", t);
  }, theme);
  await page.clock.install({ time: new Date("2023-11-14T22:13:20.000Z") });
  await page.goto("/");
  await page.addStyleTag({ content: PIN_SCROLLBARS });
  await expect(page.locator("#editor .cm-content")).toBeVisible();
  await expect(page.locator("#statusLine")).toContainText("loaded", { timeout: 30_000 });
  await expect(page.locator("#btnBuildMenu")).toBeEnabled();
  await expect(page.locator("#dCpu")).toHaveText("18%", { timeout: 10_000 });
  await expect(page.locator("#checkNote")).not.toHaveText("—", { timeout: 15_000 });
  await expect(page.getByTestId("gate-checked")).not.toContainText("not checked", {
    timeout: 30_000,
  });
  await expect(page.locator("#optionsPeek")).not.toHaveText("…", { timeout: 10_000 });
  await expect(page.locator("#historySpark .spark")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#slotSelect")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  // The status line is the one transient element in the shot; it settles on
  // "loaded scripts/main.ts" and nothing else moves after it.
  await page.waitForTimeout(500);
}

test.describe("hero screenshots", () => {
  test.use({ viewport: VIEWPORT });

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
