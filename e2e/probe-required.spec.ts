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

  test("failed probe cannot restore stale progress", async ({ page }) => {
    await mockDeviceApis(page);

    await page.route("**/api/probe/progress", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, done: 0, total: 109 }),
      });
    });
    await page.route("**/api/probe", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "probe failed for test" }),
      });
    });

    await page.goto("/");
    await expect(page.locator("#editor .cm-content")).toBeVisible();
    await expect(page.locator("#statusLine")).toContainText("loaded", { timeout: 30_000 });

    await page.locator("#btnProbe").click();
    await expect(page.locator("#statusLine")).toContainText("probe failed for test");
    await page.waitForTimeout(500);
    await expect(page.locator("#statusLine")).not.toContainText("probing… 0/109");
    await expect(page.locator("#readinessRail")).not.toContainText("probing 0/109");
  });

  test("probe banner locks during eco pre-check", async ({ page }) => {
    await mockDeviceApis(page);

    let releaseEco!: () => void;
    const ecoStarted = new Promise<void>((resolve) => {
      releaseEco = resolve;
    });
    let ecoRequested!: () => void;
    const ecoRequest = new Promise<void>((resolve) => {
      ecoRequested = resolve;
    });
    await page.route("**/api/probe/state**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          required: true,
          reason: "never-probed",
          ver: mockDeviceStatus.device.ver,
          matched: null,
          newest: null,
          skipped: null,
          captures: [],
        }),
      });
    });
    await page.route("**/api/device/eco", async (route) => {
      ecoRequested();
      await ecoStarted;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, eco_mode: false }),
      });
    });

    await page.goto("/");
    const banner = page.locator(".probe-banner-required");
    const run = banner.getByRole("button", { name: "Run probe" });
    const skip = banner.getByRole("button", { name: "Skip for now" });
    await expect(run).toBeVisible();

    await run.click();
    await ecoRequest;
    await expect(run).toBeDisabled();
    await expect(skip).toBeDisabled();
    await expect(page.locator("#btnProbe")).toBeDisabled();

    releaseEco();
    await expect(run).toBeEnabled();
  });

  test("unsupported Gen1 device explains removal", async ({ page }) => {
    await mockDeviceApis(page);
    const device = {
      id: "dimmer2", label: "Cinema Main", ip: "192.168.1.9", hasPassword: false,
      slots: {}, unsupported: { gen: null, model: "SHDM-2", at: new Date().toISOString() },
      probe: { required: true, reason: "never-probed", ver: null, at: null },
    };
    await page.route("**/api/devices", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, devices: [device], active: { device: device.id, slot: 1, script: "main" } }) });
      } else await route.fallback();
    });
    await page.route("**/api/probe/state**", async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, required: true, reason: "never-probed", ver: null, matched: null, newest: null, skipped: null, captures: [] }) });
    });
    await page.goto("/");
    await expect(page.locator("#editor .cm-content")).toBeVisible();
    const banner = page.locator(".probe-banner-required");
    await expect(banner).toContainText("SHDM-2");
    await expect(banner).toContainText("no script runtime");
    await expect(banner.getByRole("button", { name: "Run probe" })).toHaveCount(0);
    await expect(banner.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
    await expect(page.locator("#btnDeploy")).toBeDisabled();
  });
});
