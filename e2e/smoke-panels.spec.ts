import { expect, test, type Page } from "./helpers/test-base";
import { openApp } from "./helpers/open-app";

/** Successful `PATCH /api/config` reply means shellint.json is written. */
function patchResponse(page: Page) {
  return page.waitForResponse(
    (r) =>
      r.url().includes("/api/config") &&
      r.request().method() === "PATCH" &&
      r.ok(),
  );
}

/**
 * Resolve after the frame that lays out a pending style change, and the one
 * after it. Everything the header reflows on is a CSS breakpoint over system
 * fonts (`--sans-narrow`, tokens.css), so once those two frames are in there
 * is nothing left pending — no web font, no transition, no async measure.
 */
function nextLayout(page: Page) {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test.describe("panels smoke", () => {
  test("inspector tabs are mutually exclusive and persist", { tag: "@layout" }, async ({ page }) => {
    await openApp(page);
    await expect(page.locator("#pane-build")).toBeVisible();
    await expect(page.locator("#pane-check")).toBeHidden();

    await page.getByTestId("tab-check").click();
    await expect(page.getByTestId("tab-check")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#pane-check")).toBeVisible();
    await expect(page.locator("#pane-build")).toBeHidden();

    // The choice is remembered, unlike the old accordions. (A reload cannot be
    // asserted here: openApp clears localStorage on every navigation.)
    const stored = await page.evaluate(() =>
      localStorage.getItem("shellint.inspectorTab"),
    );
    expect(stored).toBe("check");
  });

  test("a readiness gate pill switches the inspector tab", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("gate-checked").click();
    await expect(page.locator("#pane-check")).toBeVisible();
    await page.getByTestId("gate-built").click();
    await expect(page.locator("#pane-build")).toBeVisible();
  });

  test("options panel PATCHes minify config", { tag: "@layout" }, async ({ page }) => {
    await openApp(page);
    await expect(page.locator("#pane-options")).toBeHidden();
    await page.getByTestId("tab-options").click();
    await expect(page.locator("#pane-options")).toBeVisible();
    await expect(page.getByTestId("opt-compress")).toBeVisible();

    // The panel renders its defaults first and repaints when /api/config lands,
    // so read `before` only once that has happened — otherwise the click races
    // the response, which then overwrites the toggle with the server's value.
    // `#optionsPeek` is "…" until then (options-panel.tsx `loaded`).
    await expect(page.locator("#optionsPeek")).not.toHaveText("…", {
      timeout: 15_000,
    });

    // shellint.json owns defaults, so assert flip rather than value.
    const toplevel = page.getByTestId("opt-toplevel");
    const before = await toplevel.isChecked();
    // Wait for response: route writes shellint.json before replying,
    // and waiting on the request alone can end the test — and with it the
    // webServer — before the write lands.
    const patch = patchResponse(page);
    await toplevel.click();
    const res = await patch;
    await expect(toplevel).toBeChecked({ checked: !before });
    expect(res.request().postData() ?? "").toMatch(/toplevel/);
    await expect(page.locator("#statusLine")).toContainText("minify options saved", {
      timeout: 10_000,
    });

    // Restore so later runs / design snapshots keep default config.
    const restore = patchResponse(page);
    await toplevel.click();
    await restore;
    await expect(toplevel).toBeChecked({ checked: before });
  });

  test("option tip stays inside the viewport on the last option", { tag: "@layout" }, async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId("tab-options").click();
    await expect(page.locator("#pane-options")).toBeVisible();

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

  test("device panel shows mocked mem/cpu; logs show mocked lines", { tag: "@layout" }, async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.locator("#dMem")).toContainText("KB", { timeout: 10_000 });
    await expect(page.locator("#dCpu")).toHaveText("18%");
    await expect(page.locator("#dockPeek")).toContainText("cpu");

    await page.locator("#logsHead").click();
    await expect(page.locator("#logsPanel")).toBeVisible();
    await page.locator("#btnLogs").click();
    await expect(page.locator("#logsList li")).toHaveCount(3, { timeout: 10_000 });
    await expect(page.locator("#logsList")).toContainText("boot complete");
    await expect(page.locator("#logsPeek")).toContainText("lines");
  });

  test("header children never overlap or spill at narrow widths", { tag: "@layout" }, async ({ page }) => {
    await openApp(page);
    for (const width of [1440, 1100, 900, 780, 640]) {
      await page.setViewportSize({ width, height: 700 });
      await nextLayout(page);
      const boxes = await page.evaluate(() =>
        [...document.querySelectorAll("header.top > *")]
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { id: el.id || el.className, left: r.left, right: r.right };
          }),
      );
      let prev = 0;
      for (const b of boxes) {
        expect(b.left, `${b.id} at ${width}px overlaps its neighbour`).toBeGreaterThanOrEqual(
          prev - 0.5,
        );
        prev = b.right;
      }
      expect(prev, `header spills past ${width}px`).toBeLessThanOrEqual(width + 0.5);
    }
  });

  test("dock splitter resizes the dock and persists", { tag: "@layout" }, async ({ page }) => {
    await openApp(page);
    const dock = page.locator("#dock");
    const handle = page.locator("#dockSplitter");
    const dockHeight = () => dock.evaluate((el) => el.getBoundingClientRect().height);
    await page.locator("#dockToggle").click();
    // The handle moves while the 180ms open transition runs, so wait for where
    // it ends up — the 300px default of `.dock.open` (panels.css) — rather than
    // for the clock.
    await expect(handle).toBeVisible();
    await expect.poll(dockHeight).toBeCloseTo(300, 0);

    const before = await dockHeight();
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2, hb.y - 120, { steps: 8 });
    await page.mouse.up();

    // No settle wait after the drag: `body.row-resizing .dock` suppresses the
    // transition for its duration, and endDrag (web/ui/splitter.ts) applies the
    // size and writes localStorage synchronously on pointerup — so the height
    // is already final here.
    await expect.poll(dockHeight).toBeGreaterThan(before + 100);
    const after = await dockHeight();

    // The dock takes the height from the workspace instead of overlapping it.
    const ws = (await page.locator("#workspace").boundingBox())!;
    expect(ws.y + ws.height).toBeLessThanOrEqual((await dock.boundingBox())!.y + 1);

    // Persisted for the next session (openApp clears storage on every
    // navigation, so assert the write rather than a reload).
    const stored = await page.evaluate(() =>
      localStorage.getItem("shellint.dock.height"),
    );
    expect(Math.abs(Number(stored) - after)).toBeLessThan(3);

    // Double-click resets to the 300px default.
    await handle.dblclick();
    await expect.poll(dockHeight).toBeCloseTo(300, 0);
  });

  test("device overflow menu shows Reboot device", { tag: "@layout" }, async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("device-menu-btn")).toBeVisible();
    await page.getByTestId("device-menu-btn").click();
    const item = page.getByTestId("device-reboot-item");
    await expect(item).toBeVisible();
    await expect(item).toHaveText("Reboot device");
    await expect(item).toBeEnabled();
  });

  test("stat tip portals to body and stays left of #side", { tag: "@layout" }, async ({ page }) => {
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
