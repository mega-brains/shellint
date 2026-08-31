import { expect, test, type Page } from "./helpers/test-base";
import { openCheckTab } from "./helpers/check-tab";
import { STATIC_PORT } from "./playwright.config";

/**
 * Playwright against `site/` (M17.8, moved under `site/demo/` by M26), served
 * by the plain static server from `scripts/preview-static.mjs` (wired as a
 * second `webServer` entry in playwright.config.ts) — proving the
 * offline/device-less build works end to end with zero relation to the
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
    await page.route("https://api.github.com/repos/mega-brains/shellint/releases/latest", (route) =>
      route.fulfill({
        json: {
          tag_name: "v9.8.7",
          published_at: "2026-08-28T09:20:16Z",
          html_url: "https://github.com/mega-brains/shellint/releases/tag/v9.8.7",
          assets: [{
            name: "shellint-macos-arm64.zip",
            size: 3_759_339,
            browser_download_url: "https://example.test/shellint-macos-arm64.zip",
          }],
        },
      }),
    );
    await page.goto(`${STATIC_BASE}/`);
    await expect(page.locator("#site")).toBeVisible();
    await page.locator("#ctaDownload").click();
    await expect(page).toHaveURL(`${STATIC_BASE}/download.html`);
    await expect(page.locator("#downloadTable")).toBeVisible();
    await expect(page.locator("#releases")).toContainText("v9.8.7");
    await expect(page.locator("#downloadTable")).toContainText("3.59 MB");
  });

  test("theme toggled on the landing persists into the demo", { tag: "@browser-api" }, async ({ page }) => {
    // Deliberately not openStatic(): that helper's init script clears
    // localStorage on every load, which would erase the very theme choice
    // this test exists to prove survives a navigation (same origin, same
    // "shellint.theme" key — web/shell/theme.ts).
    await page.goto(`${STATIC_BASE}/`);
    await page.evaluate(() => localStorage.removeItem("shellint.theme"));
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBeDefined();
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

  test("docs page renders its sections and the TOC links into them", async ({ page }) => {
    await page.goto(`${STATIC_BASE}/docs.html`);
    await expect(page.locator("#docs")).toBeVisible();
    // The security warning is the one section whose absence would be a real
    // problem — it is the reason the page links from the download page at all.
    await expect(page.locator("#security")).toContainText("no authentication of its own");
    await page.locator('.docs-toc a[href="#commands"]').click();
    await expect(page).toHaveURL(`${STATIC_BASE}/docs.html#commands`);
    await expect(page.locator("#commands")).toBeVisible();
  });

  test("checks page lists the catalog and filters it", async ({ page }) => {
    await page.goto(`${STATIC_BASE}/checks.html`);
    // Rendered from server/lint/check-catalog.ts, so the count is whatever the
    // engine currently ships; asserting a floor keeps this from becoming a
    // second place to update when a rule is added.
    const rows = page.locator(".checks-table tbody tr");
    const total = await rows.count();
    expect(total).toBeGreaterThan(40);
    await expect(page.locator("#checkCount")).toContainText(`${total} of ${total}`);

    await page.locator("#checkSearch").fill("probe-absent-api");
    await expect(rows).toHaveCount(1);
    await expect(page.locator("#check-probe-absent-api")).toBeVisible();

    await page.locator("#checkSearch").fill("no-such-rule-anywhere");
    await expect(page.locator("#checkEmpty")).toBeVisible();
  });

  test("the example badge reveals a rule's before/after on hover", async ({ page }) => {
    await page.goto(`${STATIC_BASE}/checks.html`);

    // no-regexp carries a RULE_TIPS example (web/check/check-tips.ts): a badge
    // in the Example column, and a card that only paints while it is hovered.
    const row = page.locator("#check-no-regexp");
    const card = row.locator(".check-ex-card");
    await expect(card).toBeHidden();
    await row.locator(".check-ex-badge").hover();
    await expect(card).toBeVisible();
    await expect(card.locator(".check-ex-line.diff-del")).toHaveCount(1);
    await expect(card.locator(".check-ex-line.diff-add")).toHaveCount(1);
    await expect(card).toContainText("charAt");
    // web/site/code-highlight.tsx: `var` is a keyword, "0"/"9" are strings.
    await expect(card.locator(".tok-keyword").first()).toHaveText("var");
    await expect(card.locator(".tok-string").first()).toHaveText('"0"');

    // Hovering the row itself is not the trigger — only the badge is.
    await page.locator("#check-no-regexp td").first().hover();
    await expect(card).toBeHidden();

    // syntax-error has no fixed code shape, so it gets no badge at all.
    await expect(page.locator("#check-syntax-error .check-ex-badge")).toHaveCount(0);
  });

  test("header nav reaches the docs and checks pages", async ({ page }) => {
    await page.goto(`${STATIC_BASE}/`);
    await page.locator('.site-nav a[href="./docs.html"]').click();
    await expect(page).toHaveURL(`${STATIC_BASE}/docs.html`);
    await page.locator('.site-nav a[href="./checks.html"]').click();
    await expect(page).toHaveURL(`${STATIC_BASE}/checks.html`);
    await expect(page.locator(".checks-table").first()).toBeVisible();
  });

  test("the FAQ page answers from the nav, and deep-links per question", async ({ page }) => {
    await page.goto(`${STATIC_BASE}/`);
    await page.locator('.site-nav a[href="./faq.html"]').click();
    await expect(page).toHaveURL(`${STATIC_BASE}/faq.html`);
    await expect(page.locator("#faq")).toBeVisible();
    // Every question carries its own id so an answer can be linked to; the
    // history one is also the answer the docs page no longer holds.
    await expect(page.locator("#history")).toContainText("last 10 saved versions");
    await page.locator('.docs-toc a[href="#project"]').click();
    await expect(page).toHaveURL(`${STATIC_BASE}/faq.html#project`);
  });

  test("the stack page credits the dependencies it ships", async ({ page }) => {
    await page.goto(`${STATIC_BASE}/stack.html`);
    await expect(page.locator("#stack")).toBeVisible();
    // One runtime dependency is the claim the page opens with, so the table
    // that backs it has exactly one row — this fails if package.json grows one.
    await expect(page.locator("#runtime .stack-table tbody tr")).toHaveCount(1);
    await expect(page.locator("#runtime")).toContainText("ws");
    // Footer is the only link in; it is not in the header nav.
    await page.goto(`${STATIC_BASE}/`);
    await page.locator('.site-footer a[href="./stack.html"]').click();
    await expect(page).toHaveURL(`${STATIC_BASE}/stack.html`);
  });

  test("the landing probe spotlight reaches the probe page", async ({ page }) => {
    // The spotlight is the page's only entry into probe.html — it deliberately
    // is not a sixth item in the header nav, so this link is the contract.
    await page.goto(`${STATIC_BASE}/`);
    await page.locator("#ctaProbe").click();
    await expect(page).toHaveURL(`${STATIC_BASE}/probe.html`);
    await expect(page.locator(".probe-flow")).toBeVisible();
    // The always-visible before/after pair, unlike the checks page's hover card.
    await expect(page.locator(".probe-pair .diff-del")).toHaveCount(2);
    await expect(page.locator(".probe-pair .diff-add")).toHaveCount(2);
  });

  test("probe page lists the catalog and filters it", async ({ page }) => {
    await page.goto(`${STATIC_BASE}/probe.html`);
    // Rendered from server/probe/probe-catalog.ts — same reasoning as the
    // checks test above: assert a floor, not the current count, so adding a
    // probe does not mean editing this file.
    const rows = page.locator(".probe-table tbody tr");
    const total = await rows.count();
    expect(total).toBeGreaterThan(80);
    await expect(page.locator("#probeCount")).toContainText(`${total} of ${total}`);

    // The landing spotlight and the page both count PROBES.length, so they
    // must agree — that is the whole reason neither hardcodes a number.
    await page.goto(`${STATIC_BASE}/`);
    await expect(page.locator(".hero-signals")).toContainText(String(total));

    await page.goto(`${STATIC_BASE}/probe.html`);
    await page.locator("#probeSearch").fill("string.padStart");
    await expect(rows).toHaveCount(1);
    await expect(page.locator("#probe-string\\.padStart")).toBeVisible();

    // Filtering by group narrows to that bucket and nothing else.
    await page.locator("#probeSearch").fill("");
    await page.locator("#probeGroup").selectOption("memory");
    await expect(page.locator(".checks-tier")).toHaveCount(1);
    await expect(page.locator("#group-memory")).toBeVisible();

    await page.locator("#probeGroup").selectOption("all");
    await page.locator("#probeSearch").fill("no-such-probe-anywhere");
    await expect(page.locator("#probeEmpty")).toBeVisible();
  });

  /**
   * web/static/analytics.ts only ever runs against the collector's `s.js`, which
   * the demo build injects only when COLLECTOR_ORIGIN is set — never here. So
   * this stubs the one API it uses (`globalThis.__da.trackEvent`) and reads the
   * calls back, which also pins the two ways the counts have silently lied:
   * an event has to be a press (loading the page is not one), and pressing
   * twice has to count twice.
   */
  test("feature events count presses, not page loads", async ({ page }) => {
    await page.addInitScript(() => {
      const calls: string[][] = [];
      (globalThis as unknown as Record<string, unknown>).__daCalls = calls;
      (globalThis as unknown as Record<string, unknown>).__da = {
        trackEvent: (ev: string, target?: string) => calls.push([ev, target ?? ""]),
      };
    });
    const targets = () =>
      page.evaluate(
        () => ((globalThis as unknown as { __daCalls: string[][] }).__daCalls).map((c) => c[1]),
      );

    await openStatic(page);
    // The mount-time load runs its own quiet check and, until the static flag
    // lands, would have polled the device routes — neither is a visitor action.
    expect(await targets()).toEqual([]);

    for (const _ of [0, 1]) {
      await page.locator("#btnBuildMenu").click();
      await page.locator('#buildMenu button[data-action="check"]').click();
      await expect(page.locator("#checkNote")).toContainText("device profile", {
        timeout: 45_000,
      });
    }
    // Two presses, plus the once-per-tab-session copy of the first.
    expect(await targets()).toEqual(["check", "check@1st", "check"]);
  });
});
