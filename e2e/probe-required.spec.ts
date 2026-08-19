import { expect, test } from "./helpers/test-base";
import { mockDeviceApis, mockDeviceStatus } from "./helpers/mock-api";

/**
 * M16: a device active with no matching probe capture must show the
 * probe-required banner and disable Deploy; a skip must lift both.
 * `mockDeviceApis` defaults every device to a satisfied probe state (see
 * device-switch.spec.ts's regression check), so this overrides just the
 * two routes the banner and the skip button touch.
 */
test.describe("probe-required gate", () => {
  test("banner blocks Deploy until skipped", async ({ page }) => {
    await mockDeviceApis(page);

    let required = true;
    await page.route("**/api/probe/state**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          required,
          reason: "never-probed",
          ver: mockDeviceStatus.device.ver,
          matched: null,
          newest: null,
          skipped: null,
          captures: [],
        }),
      });
    });
    await page.route("**/api/probe/skip", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      required = false;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          required: false,
          reason: "never-probed",
          ver: mockDeviceStatus.device.ver,
          matched: null,
          newest: null,
          skipped: { ver: mockDeviceStatus.device.ver, at: new Date().toISOString() },
          captures: [],
        }),
      });
    });

    await page.addInitScript(() => {
      localStorage.clear();
    });
    await page.goto("/");
    await expect(page.locator("#editor .cm-content")).toBeVisible();
    await expect(page.locator("#statusLine")).toContainText("loaded", { timeout: 30_000 });

    const banner = page.locator(".probe-banner-required");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("never probed");

    // Deploy is also gated on Build + Check — run the default action so the
    // probe gate is the *only* thing left holding it disabled.
    await page.locator("#btnBuild").click();
    await expect(page.locator("#statusLine")).toContainText("check ", { timeout: 45_000 });
    await expect(page.locator("#btnDeploy")).toBeDisabled();
    await expect(page.locator("#btnDeploy")).toHaveAttribute("title", /probed/);

    await banner.getByRole("button", { name: "Skip for now" }).click();

    await expect(page.locator(".probe-banner-required")).toHaveCount(0);
    await expect(page.locator(".probe-banner-skipped")).toContainText("skipped");
    await expect(page.locator("#btnDeploy")).toBeEnabled();
  });
});
