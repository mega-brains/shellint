import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/open-app";

test.describe("editor smoke", () => {
  test("boots with editor, sidebar, footer", async ({ page }) => {
    await openApp(page);
    await expect(page).toHaveTitle("Shelly DevRoom");
    await expect(page.locator("#editor")).toBeVisible();
    await expect(page.locator("#side")).toBeVisible();
    await expect(page.locator("#dock")).toBeVisible();
    await expect(page.locator("#btnSave")).toBeVisible();
    await expect(page.locator(".artifact-strip")).toBeVisible();
    await expect(
      page.locator('.artifact-chip[data-value="source"]'),
    ).toHaveAttribute("aria-pressed", "true");
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
    await expect(page.getByTestId("gate-checked")).not.toContainText("not checked");
  });

  test("artifact chips can leave source mode", async ({ page }) => {
    await openApp(page);
    const chips = page.locator(".artifact-chip[data-value]");
    await expect(chips.first()).toHaveAttribute("data-value", "source");
    const count = await chips.count();
    if (count < 2) {
      test.info().annotations.push({
        type: "note",
        description: "no dist artifacts yet — only the source chip is present",
      });
      return;
    }
    await chips.nth(1).click();
    await expect(page.locator("#artifactMeta")).toContainText(/B|bytes|preview/i);
    await expect(page.locator("#btnSave")).toBeDisabled();
  });

  test("diff modal reports per-side size in chars and bytes", async ({
    page,
  }) => {
    await openApp(page);
    const item = page.locator('#diffMenu button[data-value="diff:side-by-side"]');
    // Only the side-by-side entry opens the modal; "diff:debug↔prod" renders
    // inline in the editor and has no head of its own.
    if ((await item.count()) === 0) {
      test.info().annotations.push({
        type: "note",
        description: "no side-by-side diff option — dist not built",
      });
      return;
    }
    await page.locator("#btnDiffMenu").click();
    await item.click();
    const size = /^\d+ ch · \d+ B$/;
    await expect(page.getByTestId("diff-size-left")).toHaveText(size, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("diff-size-right")).toHaveText(size);
  });
});
