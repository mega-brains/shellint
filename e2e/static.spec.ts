import { expect, test, type Page } from "./helpers/test-base";
import { openCheckTab } from "./helpers/check-tab";
import { STATIC_PORT } from "./playwright.config";

/**
 * Playwright against `site/` (M17.8, moved under `site/demo/` by M26), served
 * by the plain static server from `scripts/preview-static.mjs` (wired as a
 * second `webServer` entry in playwright.config.ts) — proving the
 * offline/device-less build works end to end with zero relation to the Hono
 * dev server the other specs use. The demo app itself lives one level down
 * from the site root now (`${STATIC_BASE}/demo/`); the landing/download shell
 * around it is covered separately below.
 */
const STATIC_BASE = `http://127.0.0.1:${STATIC_PORT}`;

const JS_SAMPLE = [
  "var GREETING = 'static-e2e';",
  "function log(msg) {",
  "  if (meta.env.debug) { console.log(GREETING + ' ' + msg); }",
  "}",
  "Timer.set(1000, true, function () { log('tick'); });",
  "",
].join("\n");

const TS_SAMPLE = [
  "const GREETING: string = 'static-e2e-ts';",
  "function log(msg: string): void {",
  "  if (meta.env.debug) { console.log(GREETING + ' ' + msg); }",
  "}",
  "Timer.set(1000, true, function () { log('tick'); });",
  "",
].join("\n");

async function openStatic(page: Page) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`${STATIC_BASE}/demo/`);
  await expect(page.locator("#editor .cm-content")).toBeVisible();
  await expect(page.locator("#statusLine")).toContainText("loaded", {
    timeout: 30_000,
  });
  await expect(page.locator("#btnBuildMenu")).toBeEnabled();
}

/** `marker` is a substring the opened source is known to contain, proving the
 *  editor really swapped documents rather than just reporting that it did. */
async function openFile(page: Page, name: string, source: string, marker = "GREETING") {
  await page.setInputFiles("#staticOpenFile", {
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await expect(page.locator("#statusLine")).toContainText(`opened ${name}`);
  await expect(page.locator("#editor .cm-content")).toContainText(marker);
}

/** Load → Check (tier-4 rows skipped offline) → Build → preview/diff → download. */
async function runFullCycle(page: Page, name: string, source: string) {
  await openStatic(page);
  await openFile(page, name, source);

  // Check: no device profile is ever available offline, so every capability
  // (tier-4) rule must report skipped, never a bare "pass" (M17 plan §4).
  // Waiting on "not — " alone would false-pass immediately: the catalog-only
  // pendingRows() note ("press Check to run all of them…") isn't "—" either,
  // so it'd race ahead of the real report — "device profile" only appears in
  // deriveView's report branch (check-panel.tsx).
  await page.locator("#btnBuildMenu").click();
  await page.locator('#buildMenu button[data-action="check"]').click();
  await expect(page.locator("#checkNote")).toContainText("device profile", { timeout: 45_000 });
  await openCheckTab(page);
  const componentExists = page.locator("#checkRules .check", {
    has: page.locator(".check-rule-name", { hasText: "component-exists" }),
  });
  await expect(componentExists).toHaveClass(/check-skipped/);

  // Build: produces the six dist artifacts entirely in the worker.
  await page.locator("#btnBuildMenu").click();
  await page.locator('#buildMenu button[data-action="build"]').click();
  await expect(page.locator("#statusLine")).toContainText("build ok", { timeout: 45_000 });

  // Artifact preview.
  await expect(page.locator('.artifact-chip[data-value="debug.js"]')).toBeVisible();
  await page.locator('.artifact-chip[data-value="debug.js"]').click();
  await expect(page.locator("#artifactMeta")).toContainText("B");

  // Diff: debug ↔ prod (raw).
  await page.locator("#btnDiffMenu").click();
  await page.locator('#diffMenu button[data-value="diff:debug↔prod"]').click();
  await expect(page.locator("#artifactMeta")).toBeVisible();

  // Download: the primary "Artifacts" button fires every built artifact
  // sequentially; the first `download` event is enough to prove the pipeline
  // is real (non-empty bytes), not a stub.
  await page.locator('.artifact-chip[data-value="source"]').click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#btnDownloadArtifacts").click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  let total = 0;
  for await (const chunk of stream!) total += (chunk as Buffer).length;
  expect(total).toBeGreaterThan(0);
}

test.describe("static/offline build (M17)", () => {
  test("full cycle with a .js file", { tag: "@browser-api" }, async ({ page }) => {
    await runFullCycle(page, "sample.js", JS_SAMPLE);
  });

  test("full cycle with a .ts file", { tag: "@browser-api" }, async ({ page }) => {
    await runFullCycle(page, "sample.ts", TS_SAMPLE);
  });

  // Deploy and Probe need a device, so they're gone. Save keeps its dropdown:
  // checkpoint/history run off localStorage here (local-api.ts), so the menu
  // must be populated rather than opening onto an empty list.
  test("device-only controls absent, Save menu intact", async ({ page }) => {
    await openStatic(page);
    await expect(page.locator("#btnSave")).toBeVisible();
    // No device means no pickers, no run-state chip, and a hollow probe gate.
    await expect(page.locator("#staticNote")).toContainText("no device");
    await expect(page.locator("#deviceSelect")).toHaveCount(0);
    await expect(page.getByTestId("gate-probed")).toHaveClass(/gate-unavailable/);
    await expect(page.locator("#dock")).toHaveCount(0);
    for (const id of ["#deploySplit", "#probeSplit"]) {
      await expect(page.locator(id)).toHaveCount(0);
    }
    await page.locator("#btnSaveMenu").click();
    await expect(page.locator('#saveMenu button[data-action="checkpoint"]')).toBeVisible();
    await expect(page.locator("#btnHistory")).toBeVisible();
  });

  test("checkpoint and history round-trip offline", { tag: "@browser-api" }, async ({ page }) => {
    await openStatic(page);
    // Opening a file writes it through `PUT /api/script`, which snapshots what
    // it replaces — so this alone seeds a history row.
    await openFile(page, "v1.js", "// version one\n", "version one");

    await page.locator("#btnSaveMenu").click();
    await page.locator('#saveMenu button[data-action="checkpoint"]').click();
    await expect(page.locator("#statusLine")).toContainText("checkpoint");

    await openFile(page, "v2.js", "// version two\n", "version two");

    await page.locator("#btnSaveMenu").click();
    await page.locator("#btnHistory").click();
    await expect(page.locator(".script-history-row").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("boots and builds after going offline", { tag: "@browser-api" }, async ({ page, context }) => {
    await openStatic(page);

    // One full cycle online first, so the service worker's install event has
    // something to have precached (and so `navigator.serviceWorker.ready`
    // below actually resolves against an activated worker).
    await page.locator("#btnBuildMenu").click();
    await page.locator('#buildMenu button[data-action="build"]').click();
    await expect(page.locator("#statusLine")).toContainText("build ok", { timeout: 45_000 });

    // `.ready` resolves once a worker is active with nothing still installing —
    // by spec, install's `event.waitUntil(cache.addAll(...))` has already
    // settled by then, so precaching is guaranteed done, not just "started".
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.locator("#editor .cm-content")).toBeVisible({ timeout: 15_000 });
      await page.locator("#btnBuildMenu").click();
      await page.locator('#buildMenu button[data-action="build"]').click();
      await expect(page.locator("#statusLine")).toContainText("build ok", { timeout: 45_000 });
    } finally {
      await context.setOffline(false);
    }
  });
});

test.describe("presentation site (M26)", () => {
  // Selectors here are the agreed contract with the agent building web/site/*:
  // landing root #site, hero CTAs #ctaDemo/#ctaDownload, the shared theme
  // toggle #themeToggle (reused by both the landing and download pages), and
  // the download page's platform table #downloadTable.

  test("landing loads and the demo CTA navigates into the booted app", async ({ page }) => {
    await page.goto(`${STATIC_BASE}/`);
    await expect(page.locator("#site")).toBeVisible();
    await page.locator("#ctaDemo").click();
    await expect(page).toHaveURL(new RegExp(`${STATIC_BASE}/demo/?$`));
    // The demo is the same M17 app as the rest of this file — its editor
    // booting is proof the move to /demo/ didn't break asset resolution.
    await expect(page.locator("#editor .cm-content")).toBeVisible();
  });

  test("landing loads and the download CTA reaches /download.html", async ({ page }) => {
    await page.goto(`${STATIC_BASE}/`);
    await expect(page.locator("#site")).toBeVisible();
    await page.locator("#ctaDownload").click();
    await expect(page).toHaveURL(`${STATIC_BASE}/download.html`);
    await expect(page.locator("#downloadTable")).toBeVisible();
  });

  test("theme toggled on the landing persists into the demo", { tag: "@browser-api" }, async ({ page }) => {
    // Deliberately not openStatic(): that helper's init script clears
    // localStorage on every load, which would erase the very theme choice
    // this test exists to prove survives a navigation (same origin, same
    // "shellint.theme" key — web/shell/theme.ts).
    await page.goto(`${STATIC_BASE}/`);
    await page.evaluate(() => localStorage.removeItem("shellint.theme"));
    const before = await page.evaluate(() => document.documentElement.dataset.theme);

    await page.locator("#themeToggle").click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .not.toBe(before);
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("shellint.theme")))
      .toBe(after);

    await page.goto(`${STATIC_BASE}/demo/`);
    await expect(page.locator("#editor .cm-content")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
  });
});
