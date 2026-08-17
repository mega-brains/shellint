import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockBuildApis, mockDeviceApis } from "./helpers/mock-api";

const VOLATILE = [
  "#statusLine",
  "#dLatency",
  "#hLatency",
  "#hTemp",
  "#hRssi",
  "#hMem",
  "#hCpu",
  "#hRam",
  "#hFs",
  "#historySpark",
  "#memSpark",
  "#logsSpark",
  // Rail summary + gate pills carry the same live tallies.
  "#railSummary",
  "#checkScale",
  // Live /api/config minify flags (smoke can toggle; peek text drifts).
  "#optionsPeek",
  // Pass/warn/skip tallies from a real /api/check run — the skipped count moves
  // with whatever device profile + probe cache is mirrored into types/.
  "#checkPeek",
  "#gate-checked",
  // Sits at (x≈18, y≈5) — right where a fresh page's un-moved cursor defaults
  // to — and is a dotted underline plus a 4-direction text-shadow halo on
  // small monospace text, which is the exact combination CDP/Chromium render
  // with the least stable subpixel antialiasing. Content is deterministic
  // (mocked device status + real, unmocked /api/config), only the
  // rasterization isn't.
  "#deviceIp",
  // Native <select> controls (M15 device/slot pickers) — same subpixel
  // antialiasing instability as #deviceIp, deterministic content aside.
  "#deviceSelect",
  "#slotSelect",
];

/**
 * macOS shows either overlay scrollbars (0px) or classic ones (15px) depending
 * on the machine's "Show scroll bars" setting / attached mouse. `#side` reserves
 * that width via `scrollbar-gutter: stable`, and its measure rows reflow
 * around the difference — so baselines recorded on one machine fail on the
 * other. Styling `::-webkit-scrollbar` opts
 * Chrome out of overlay behaviour, pinning the gutter to 0 everywhere.
 */
const PIN_SCROLLBARS = `
*::-webkit-scrollbar { width: 0; height: 0; }
*::-webkit-scrollbar-thumb, *::-webkit-scrollbar-track { background: transparent; }
`;

/**
 * The checked gate's label carries live tallies ("checked 3 warn · 52/66"), so
 * its pill width — and every rail item after it — moves with whatever the
 * device answered. Masking hides the text but not the reflow it causes, so pin
 * the pill to a fixed box and let the mask cover it.
 */
const PIN_CHECKED_GATE = `
#gate-checked { width: 190px; overflow: hidden; }
#gate-checked .gate-text { white-space: nowrap; }
`;

async function openSettled(page: Page) {
  await mockDeviceApis(page);
  await mockBuildApis(page);
  await page.addInitScript(() => {
    localStorage.clear();
  });
  await page.clock.install({ time: new Date("2023-11-14T22:13:20.000Z") });
  await page.goto("/");
  await page.addStyleTag({ content: PIN_SCROLLBARS + PIN_CHECKED_GATE });
  await expect(page.locator("#editor .cm-content")).toBeVisible();
  await expect(page.locator("#statusLine")).toContainText("loaded", {
    timeout: 30_000,
  });
  await expect(page.locator("#btnBuildMenu")).toBeEnabled();
  // Device poll paints mocked gauges before we snapshot.
  await expect(page.locator("#dCpu")).toHaveText("18%", { timeout: 10_000 });
  await expect(page.locator("#checkRules")).not.toBeEmpty({ timeout: 15_000 });
  // Quiet check on boot fills the readiness rail — wait so snapshots do not
  // race catalog-pending vs report-complete paint.
  await expect(page.getByTestId("gate-checked")).not.toContainText("not checked", {
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

  test.skip("check tab", async ({ page }) => {
    await openSettled(page);
    await page.getByTestId("tab-check").click();
    await expect(page.locator("#pane-check")).toBeVisible();
    await expect(page.locator("#checkRules")).not.toBeEmpty();
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

  test("build menu stays clickable below header", async ({ page }) => {
    await page.setViewportSize({ width: 1012, height: 647 });
    await openSettled(page);
    await page.locator("#btnBuildMenu").click();
    const itemWidths = await page.locator("#buildMenu > li > button").evaluateAll(
      (items) => items.map((item) => {
        const { width } = item.getBoundingClientRect();
        return width === item.parentElement!.getBoundingClientRect().width;
      }),
    );
    expect(itemWidths).toEqual([true, true, true]);
    const reachable = await page.locator("#buildMenu").evaluate((menu) => {
      const box = menu.getBoundingClientRect();
      const target = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return target?.closest("#buildMenu") === menu;
    });
    expect(reachable).toBe(true);
  });

  test("dock expanded, device then logs", async ({ page }) => {
    await openSettled(page);
    await page.locator("#dockToggle").click();
    await expect(page.locator("#dock")).toHaveClass(/open/);
    await expect(page.locator("#deviceGrid")).toBeVisible();
    await page.locator("#logsHead").click();
    await expect(page.locator("#logsPanel")).toBeVisible();
    await page.locator("#btnLogs").click();
    await expect(page.locator("#logsList li")).toHaveCount(3, { timeout: 10_000 });
    await expect(page.locator("#dock")).toHaveScreenshot("footer-device-logs.png", {
      mask: masks(page),
    });
  });
});
