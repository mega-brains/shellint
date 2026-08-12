import { expect, test, type Page } from "@playwright/test";
import { mockDeviceApis } from "./helpers/mock-api";

async function openApp(page: Page) {
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

test.describe("vanilla UI smoke", () => {
  test("boots with editor, sidebar, footer", async ({ page }) => {
    await openApp(page);
    await expect(page).toHaveTitle("Shelly DevRoom");
    await expect(page.locator("#editor")).toBeVisible();
    await expect(page.locator("#side")).toBeVisible();
    await expect(page.locator("#devicePanel")).toBeVisible();
    await expect(page.locator("#logsPanel")).toBeVisible();
    await expect(page.locator("#btnSave")).toBeVisible();
    // Select collapses to opacity 0 until the bar is hovered.
    await page.locator(".artifact-bar").hover();
    await expect(page.locator("#artifactSel")).toBeVisible();
  });

  test("loads script source into CodeMirror", async ({ page }) => {
    await openApp(page);
    const text = await page.locator("#editor .cm-content").innerText();
    expect(text.length).toBeGreaterThan(40);
    expect(text).toMatch(/Victron|BINDKEY|MAC_ADDRESS|Shelly|Timer|print/);
  });

  test("Save PUTs /api/script", async ({ page }) => {
    await openApp(page);
    const put = page.waitForRequest(
      (r) => r.url().includes("/api/script") && r.method() === "PUT",
    );
    await page.locator("#btnSave").click();
    const req = await put;
    expect(req.postData() ?? "").toContain("source");
    await expect(page.locator("#statusLine")).toContainText("saved");
  });

  test("Build split menu opens and Check populates panel", async ({ page }) => {
    await openApp(page);
    await page.locator("#btnBuildMenu").click();
    await expect(page.locator("#buildMenu")).toBeVisible();
    await expect(
      page.locator('#buildMenu button[data-action="check"]'),
    ).toBeVisible();

    await page.locator('#buildMenu button[data-action="check"]').click();
    await expect(page.locator("#checkNote")).not.toHaveText("—", {
      timeout: 45_000,
    });
    await expect(page.locator("#checkRules")).not.toBeEmpty();
    await expect(page.locator("#checkPeek")).not.toHaveText("not run yet");
  });

  test("artifact select can leave source mode", async ({ page }) => {
    await openApp(page);
    const bar = page.locator(".artifact-bar");
    const sel = page.locator("#artifactSel");
    await bar.hover();
    await expect(sel).toBeVisible();
    const options = sel.locator("option");
    await expect(options.first()).toHaveAttribute("value", "source");
    const count = await options.count();
    if (count < 2) {
      test.info().annotations.push({
        type: "note",
        description: "no dist artifacts yet — only source option present",
      });
      return;
    }
    const value = await options.nth(1).getAttribute("value");
    expect(value).toBeTruthy();
    await sel.selectOption(value!);
    if (value!.startsWith("diff:")) {
      await expect(page.locator("#artifactMeta")).toBeVisible();
    } else {
      await expect(page.locator("#artifactMeta")).toContainText(/B|bytes|preview/i);
      await expect(page.locator("#btnSave")).toBeDisabled();
    }
  });

  test("diff modal reports per-side size in chars and bytes", async ({
    page,
  }) => {
    await openApp(page);
    await page.locator(".artifact-bar").hover();
    const sel = page.locator("#artifactSel");
    await expect(sel).toBeVisible();
    const values = await sel.locator("option").evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value),
    );
    // Only the side-by-side entry opens the modal; "diff:debug↔prod" renders
    // inline in the editor and has no head of its own.
    const diffValue = values.find((v) => v === "diff:side-by-side");
    if (!diffValue) {
      test.info().annotations.push({
        type: "note",
        description: "no side-by-side diff option — dist not built",
      });
      return;
    }
    await sel.selectOption(diffValue);
    const size = /^\d+ ch · \d+ B$/;
    await expect(page.getByTestId("diff-size-left")).toHaveText(size, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("diff-size-right")).toHaveText(size);
  });

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
    await expect(page.getByTestId("opt-compress")).toBeChecked();

    const patch = page.waitForRequest(
      (r) => r.url().includes("/api/config") && r.method() === "PATCH",
    );
    await page.getByTestId("opt-toplevel").click();
    const req = await patch;
    expect(req.postData() ?? "").toMatch(/toplevel/);
    await expect(page.locator("#statusLine")).toContainText("minify options saved", {
      timeout: 10_000,
    });

    // Restore so later runs / design snapshots keep default config.
    const restore = page.waitForRequest(
      (r) => r.url().includes("/api/config") && r.method() === "PATCH",
    );
    await page.getByTestId("opt-toplevel").click();
    await restore;
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
