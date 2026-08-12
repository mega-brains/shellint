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
