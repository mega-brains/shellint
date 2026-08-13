import { expect, type Page } from "@playwright/test";
import { mockDeviceApis } from "./mock-api";

/** Boot the UI with mocked device APIs and wait until the real script is in. */
export async function openApp(page: Page) {
  await mockDeviceApis(page);
  await page.addInitScript(() => {
    localStorage.clear();
  });
  await page.goto("/");
  await expect(page.locator("#editor .cm-content")).toBeVisible();
  // Buttons start enabled in HTML; wait for the real script load, not the placeholder.
  await expect(page.locator("#statusLine")).toContainText("loaded", {
    timeout: 30_000,
  });
  await expect(page.locator("#editor .cm-content")).not.toContainText("loading…");
  await expect(page.locator("#btnBuildMenu")).toBeEnabled();
}
