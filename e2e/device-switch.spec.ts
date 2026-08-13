import { expect, test, type Page } from "@playwright/test";
import { mockDeviceApis } from "./helpers/mock-api";

async function openApp(page: Page) {
  await mockDeviceApis(page);
  await page.addInitScript(() => {
    localStorage.clear();
  });
  await page.goto("/");
  await expect(page.locator("#editor .cm-content")).toBeVisible();
  await expect(page.locator("#statusLine")).toContainText("loaded", {
    timeout: 30_000,
  });
  await expect(page.locator("#btnBuildMenu")).toBeEnabled();
}

test.describe("device switch", () => {
  test("switching device repoints the deploy label and wipes the log panel", async ({
    page,
  }) => {
    await openApp(page);

    // Both mocked devices report a satisfied probe (mock-api.ts's default) —
    // the M16 probe-required banner must stay hidden. See probe-required.spec.ts
    // for the unsatisfied case (Deploy also needs a fresh Build + Check to be
    // enabled, which this spec never runs, so it is not asserted here).
    await expect(page.locator(".probe-banner-required")).toHaveCount(0);
    await expect(page.locator(".probe-banner-skipped")).toHaveCount(0);

    // Deploy label carries the active device + slot (toolbar.tsx deployTarget).
    await expect(page.locator("#btnDeploy")).toContainText("e2e-device:1");

    // Start the log stream on the first device and let mocked lines populate.
    await page.locator("#logsHead").click();
    await expect(page.locator("#logsPanel")).not.toHaveClass(/collapsed/);
    await page.locator("#btnLogs").click();
    await expect(page.locator("#logsList li")).toHaveCount(3, { timeout: 10_000 });

    // Switch to the second mocked device via the header device selector.
    const select = page.locator("#deviceSelect");
    await expect(select).toBeVisible();
    await select.selectOption({ label: "Second device (192.168.4.50)" });

    // Deploy label now reflects the new device.
    await expect(page.locator("#btnDeploy")).toContainText("Second device:1", {
      timeout: 10_000,
    });

    // The log panel remounted (keyed off the switch) — mocked lines from the
    // old device are gone, and the stream shows disconnected until restarted.
    await expect(page.locator("#logsList li")).toHaveCount(0);
  });

  test("importing a slot loads device code as an unsaved buffer", async ({ page }) => {
    await openApp(page);
    const editor = page.locator("#editor .cm-content");
    await expect(editor).not.toContainText("hello from the device slot");

    await page.locator("#slotSelect").selectOption("__import__");

    // Device code lands in the editor, with a banner saying it is unsaved JS.
    await expect(editor).toContainText("hello from the device slot", { timeout: 10_000 });
    const banner = page.locator(".import-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("not TypeScript");

    // Discard restores what the editor held before the import.
    await page.locator(".import-banner-discard").click();
    await expect(banner).toHaveCount(0);
    await expect(editor).not.toContainText("hello from the device slot");
  });
});
