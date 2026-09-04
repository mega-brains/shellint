import { expect, test } from "./helpers/test-base";
import { mockDeviceApis } from "./helpers/mock-api";

test.describe("slot list failures", () => {
  test("shows failure and retries", async ({ page }) => {
    await mockDeviceApis(page);
    let fail = true;
    await page.route("**/api/device/scripts**", async (route) => {
      if (!fail) return route.fallback();
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "connect timeout to ws://device/rpc" }),
      });
    });

    await page.goto("/");
    const select = page.locator("#slotSelect");
    await expect(select).toContainText("⚠ slot 1 — device did not answer");
    await expect(select).toHaveAttribute("title", "connect timeout to ws://device/rpc");
    await expect(page.locator("#statusLine")).toContainText("connect timeout");

    fail = false;
    await select.selectOption("__retry__");
    await expect(select).toContainText("1 · main");
    await expect(select).not.toContainText("⚠");
  });

  test("shows genuine empty slots", async ({ page }) => {
    await mockDeviceApis(page);
    await page.route("**/api/device/scripts**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, slots: [] }),
      });
    });

    await page.goto("/");
    const select = page.locator("#slotSelect");
    await expect(select).toContainText("slot 1 — not on this device");
    await expect(select).not.toContainText("⚠");
  });
});
