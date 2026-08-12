import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockDeviceApis } from "./helpers/mock-api";

const VOLATILE = [
  "#statusLine",
  "#dLatency",
  "#latencySpark",
  "#tempSpark",
  "#rssiSpark",
  "#hMem",
  "#hCpu",
  "#hRam",
  "#hFs",
  "#historySpark",
  "#memSpark",
  "#logsSpark",
  "#probeProgress",
  // Live /api/config minify flags (smoke can toggle; peek text drifts).
  "#optionsPeek",
];

async function openSettled(page: Page) {
  await mockDeviceApis(page);
  await page.addInitScript(() => {
    localStorage.clear();
  });
  await page.clock.install({ time: new Date("2023-11-14T22:13:20.000Z") });
  await page.goto("/");
  await expect(page.locator("#editor .cm-content")).toBeVisible();
  await expect(page.locator("#statusLine")).toContainText("loaded", {
    timeout: 30_000,
  });
  await expect(page.locator("#btnBuildMenu")).toBeEnabled();
  // Device poll paints mocked gauges before we snapshot.
  await expect(page.locator("#dCpu")).toHaveText("18%", { timeout: 10_000 });
  await expect(page.locator("#checkRules")).not.toBeEmpty({ timeout: 15_000 });
  // Quiet check on boot fills the permanent indicator — wait so snapshots
  // do not race catalog-pending vs report-complete paint.
  await expect(page.locator("#checkPeek")).not.toContainText("not run yet", {
    timeout: 30_000,
  });
  // Options peek loads async from /api/config; wait so layout is settled
  // even though the text itself is masked.
  await expect(page.locator("#optionsPeek")).not.toHaveText("…", {
    timeout: 10_000,
  });
}

function masks(page: Page): Locator[] {
  return VOLATILE.map((sel) => page.locator(sel));
}

test.describe("design baselines", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("full workspace default", async ({ page }) => {
    await openSettled(page);
    await expect(page).toHaveScreenshot("workspace-default.png", {
      fullPage: true,
      mask: masks(page),
    });
  });

  test("check panel with catalog", async ({ page }) => {
    await openSettled(page);
    await page.locator("#checkHead").click();
    await expect(page.locator("#checkPanel")).not.toHaveClass(/collapsed/);
    await expect(page.locator("#checkRules")).not.toBeEmpty();
    // Expanding check scrolls #side; pin bottom so the shot is stable.
    await page.locator("#side").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.locator("#side")).toHaveScreenshot("check-panel.png", {
      mask: masks(page),
    });
  });

  test("build split menu open", async ({ page }) => {
    await openSettled(page);
    const toggle = page.locator("#btnBuildMenu");
    const menu = page.locator("#buildMenu");
    await toggle.click();
    // Document-level click handlers can race the first open; retry once.
    if (await menu.isHidden()) await toggle.click();
    await expect(menu).toBeVisible();
    await expect(page.locator("header.top")).toHaveScreenshot("build-menu.png", {
      mask: masks(page),
    });
  });

  test("device + logs footer expanded", async ({ page }) => {
    await openSettled(page);
    await page.locator("#deviceHead").click();
    await expect(page.locator("#devicePanel")).not.toHaveClass(/collapsed/);
    await page.locator("#logsHead").click();
    await expect(page.locator("#logsPanel")).not.toHaveClass(/collapsed/);
    await page.locator("#btnLogs").click();
    await expect(page.locator("#logsList li")).toHaveCount(3, { timeout: 10_000 });
    await expect(page.locator("main .footer")).toHaveScreenshot(
      "footer-device-logs.png",
      { mask: masks(page) },
    );
  });
});
