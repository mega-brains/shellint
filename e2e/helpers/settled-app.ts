/**
 * The readiness gate shared by everything under `e2e/capture/`: open the app
 * against the mocked device/build APIs in a known theme and wait until nothing
 * on screen is still moving.
 *
 * It lives here rather than in `capture/header.spec.ts` because two captures
 * now depend on it — the hero screenshots and the showcase video
 * (`capture/demo.spec.ts`). A copy in each would let the pair drift, and the
 * whole point of the hero PNG being the video's `poster` is that frame 1 of the
 * video and the still are the same app in the same state.
 *
 * Not used by the gate: `e2e/playwright.config.ts` ignores `capture/**`. Specs
 * in the gate open the app through `helpers/open-app.ts` instead, which asserts
 * far less because it does not have to be pixel-quiet.
 */
import { expect, type Page } from "@playwright/test";
import { mockBuildApis, mockDeviceApis } from "./mock-api";

/** Same size as the committed hero images; the shot is a viewport, not fullPage. */
export const CAPTURE_VIEWPORT = { width: 1620, height: 908 };

/** See design.spec.ts — macOS classic vs overlay scrollbars reflow `#side`. */
export const PIN_SCROLLBARS = `
*::-webkit-scrollbar { width: 0; height: 0; }
*::-webkit-scrollbar-thumb, *::-webkit-scrollbar-track { background: transparent; }
`;

/**
 * The clock every capture installs. Fixed so timestamps in the UI are
 * reproducible across runs; `page.clock.fastForward` moves it on where a
 * capture needs time to actually pass.
 */
export const CAPTURE_EPOCH = new Date("2023-11-14T22:13:20.000Z");

export async function openSettled(page: Page, theme: "dark" | "light") {
  await mockDeviceApis(page);
  await mockBuildApis(page);
  await page.addInitScript((t) => {
    localStorage.clear();
    localStorage.setItem("shellint.theme", t);
  }, theme);
  await page.clock.install({ time: CAPTURE_EPOCH });
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
