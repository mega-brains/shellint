import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/open-app";

test.describe("panels smoke", () => {
  test("collapsible build panel toggles aria-expanded", async ({ page }) => {
    await openApp(page);
    const panel = page.locator("#buildPanel");
    const head = page.locator("#buildHead");
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await expect(panel).not.toHaveClass(/collapsed/);
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveClass(/collapsed/);
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "true");
  });

  test("options panel PATCHes minify config", async ({ page }) => {
    await openApp(page);
    const panel = page.locator("#optionsPanel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/collapsed/);
    await page.locator("#optionsHead").click();
    await expect(panel).not.toHaveClass(/collapsed/);
    await expect(page.getByTestId("opt-compress")).toBeVisible();

    // devroom.json owns the defaults, so assert the flip rather than a value.
    const toplevel = page.getByTestId("opt-toplevel");
    const before = await toplevel.isChecked();
    const patch = page.waitForRequest(
      (r) => r.url().includes("/api/config") && r.method() === "PATCH",
    );
    await toplevel.click();
    const req = await patch;
    await expect(toplevel).toBeChecked({ checked: !before });
    expect(req.postData() ?? "").toMatch(/toplevel/);
    await expect(page.locator("#statusLine")).toContainText("minify options saved", {
      timeout: 10_000,
    });

    // Restore so later runs / design snapshots keep default config.
    const restore = page.waitForRequest(
      (r) => r.url().includes("/api/config") && r.method() === "PATCH",
    );
    await toplevel.click();
    await restore;
    await expect(toplevel).toBeChecked({ checked: before });
  });

  test("option tip stays inside the viewport on the last option", async ({
    page,
  }) => {
    await openApp(page);
    await page.locator("#optionsHead").click();
    await expect(page.locator("#optionsPanel")).not.toHaveClass(/collapsed/);

    // The last option sits lowest, so its tip is the one that can run off the
    // bottom — the portal host is pointer-events:none, so overflow is unreachable.
    const items = page.locator("#optionsBody .options-item");
    await items.last().scrollIntoViewIfNeeded();
    await items.last().hover();

    const tip = page.getByTestId("opt-tip");
    await expect(tip).toBeVisible();
    const box = await tip.boundingBox();
    const vh = page.viewportSize()?.height ?? 0;
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
  });

  test("device panel shows mocked mem/cpu; logs show mocked lines", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.locator("#dMem")).toContainText("KB", { timeout: 10_000 });
    await expect(page.locator("#dCpu")).toHaveText("18%");
    await expect(page.locator("#devicePeek")).toContainText("cpu");

    await page.locator("#logsHead").click();
    await expect(page.locator("#logsPanel")).not.toHaveClass(/collapsed/);
    await page.locator("#btnLogs").click();
    await expect(page.locator("#logsList li")).toHaveCount(3, { timeout: 10_000 });
    await expect(page.locator("#logsList")).toContainText("boot complete");
    await expect(page.locator("#logsPeek")).toContainText("lines");
  });

  test("device overflow menu shows Reboot device", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("device-menu-btn")).toBeVisible();
    await page.getByTestId("device-menu-btn").click();
    const item = page.getByTestId("device-reboot-item");
    await expect(item).toBeVisible();
    await expect(item).toHaveText("Reboot device");
    await expect(item).toBeEnabled();
  });

  test("stat tip portals to body and stays left of #side", async ({ page }) => {
    await openApp(page);
    // Need badge stats — Build once if the panel is still empty.
    const empty = page.locator("#statBadges .stats-bars-empty");
    if (await empty.isVisible().catch(() => false)) {
      await page.locator("#btnBuild").click();
      await expect(page.locator("#statBadges .stat-badge").first()).toBeVisible({
        timeout: 60_000,
      });
    }
    const badge = page.locator("#statBadges .stat-badge", { hasText: "strings" });
    await expect(badge).toBeVisible();
    await badge.hover();
    const tip = page.getByTestId("stat-tip");
    await expect(tip).toBeVisible();
    // Must live under body portal host — not under #statBadges / #side.
    const portaled = await tip.evaluate((el) => {
      const host = el.parentElement;
      return !!(
        host?.hasAttribute("data-tip-portal") &&
        host.parentElement === document.body &&
        !el.closest("#statBadges, #side")
      );
    });
    expect(portaled).toBe(true);
    const tipBox = await tip.boundingBox();
    const sideBox = await page.locator("#side").boundingBox();
    expect(tipBox).toBeTruthy();
    expect(sideBox).toBeTruthy();
    // Right edge of tip must stay in the editor column (gap left of #side).
    expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(sideBox!.x - 4);
  });

  test("Deploy split menu lists mode/minify choices", async ({ page }) => {
    await openApp(page);
    // Deploy stays gated until Build+Check succeed — choices still live in DOM.
    const menu = page.locator("#deployMenu");
    await expect(
      menu.locator('button[data-mode="debug"][data-minify="min"]'),
    ).toHaveCount(1);
    await expect(
      menu.locator('button[data-mode="debug"][data-minify="raw"]'),
    ).toHaveCount(1);
    await expect(
      menu.locator('button[data-mode="prod"][data-minify="min"]'),
    ).toHaveCount(1);
    await expect(
      menu.locator('button[data-mode="prod"][data-minify="raw"]'),
    ).toHaveCount(1);

    // Open the menu for parity even when the gate still holds Deploy.
    await page.locator("#btnDeployMenu").evaluate((el: HTMLButtonElement) => {
      el.disabled = false;
    });
    await page.locator("#btnDeployMenu").click();
    await expect(menu).toBeVisible();
    await expect(
      menu.locator('button[data-mode="debug"][data-minify="min"]'),
    ).toBeVisible();
  });
});
