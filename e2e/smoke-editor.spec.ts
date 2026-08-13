import { expect, test } from "@playwright/test";
import { openApp } from "./helpers/open-app";

test.describe("editor smoke", () => {
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
});
