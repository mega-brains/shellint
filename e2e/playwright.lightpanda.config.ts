/**
 * The e2e suite against **Lightpanda** (https://lightpanda.io) instead of
 * Chromium — a headless browser with a JS engine and a DOM but, by design,
 * **no rendering and no layout engine**. It is fetched by
 * `scripts/install-lightpanda.mjs` and driven over CDP by
 * `e2e/helpers/test-base.ts`.
 *
 * What that buys: page loads land in ~100ms instead of ~1s, and a browser
 * process costs a fraction of a Chromium one.
 *
 * What it costs, and why this config runs a subset. Every exclusion below was
 * measured against the real suite, not assumed:
 *
 *   - `page.screenshot()` returns a fixed placeholder PNG reading "No
 *     screenshot available, Lightpanda has no graphical rendering engine", so
 *     every `toHaveScreenshot` baseline in design.spec.ts is meaningless here.
 *     The whole file is ignored.
 *   - `getBoundingClientRect()` answers 0×0 (or an absurd document-sized box),
 *     which takes out more than the obvious geometry assertions: Playwright's
 *     actionability check needs a visible, stable box, so `click()` and
 *     `hover()` time out on most elements and `{ force: true }` then fails
 *     "Element is outside of the viewport". Only `dispatchEvent("click")`
 *     works, and that would test a synthetic event instead of a real click.
 *     Tests that depend on either carry `{ tag: "@layout" }`.
 *   - Missing APIs, unrelated to layout: `setInputFiles`
 *     ("Cannot assign to read only property 'files'"), `navigator
 *     .serviceWorker`, `Storage.clearCookies`, and an `innerText` that drops
 *     newlines. Those tests carry `{ tag: "@browser-api" }`.
 *
 * Both tags are grep-inverted out. What is left — DOM structure, ARIA state,
 * `page.route` interception, localStorage, network assertions — does pass.
 * Treat this as a fast partial smoke; Chromium (`mise run test:e2e`) stays the
 * authority and is what the commit gate runs.
 */
import { defineConfig } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import base from "./playwright.config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CDP_PORT = 9222;

/**
 * Who owns the browser. Unset, this config starts one Lightpanda on the port
 * above and points the fixtures at it — the plain `npm run test:e2e:lightpanda`
 * path. Preset, scripts/e2e-hybrid.mjs already started one per shard, each on
 * its own port, and this config must not start another: Lightpanda serves one
 * browser context at a time, so a shard needs a browser to itself.
 */
const external = !!process.env.LIGHTPANDA_CDP;
const CDP = process.env.LIGHTPANDA_CDP ?? `ws://127.0.0.1:${CDP_PORT}/`;

/**
 * When the runner owns the browser it owns the servers too, and points this
 * pass at an app server of its own — a different port and a different fixture
 * workspace from the Chromium config's, so the two passes can run at the same
 * time without sharing mutable server state. (They cannot share one: a Build
 * triggered by this pass adds artifact chips, which moves the layout under the
 * design baselines' masks and fails them by a few hundred pixels.)
 */
const appPort = process.env.LIGHTPANDA_APP_PORT;

// Read by helpers/test-base.ts. Assigned here rather than in the npm script so
// the endpoint has one definition, and safely, because Playwright loads this
// config before any spec (and so before test-base) in every process that runs
// tests, main and worker alike.
process.env.LIGHTPANDA_CDP = CDP;

export default defineConfig({
  ...base,
  // The one selector that decides what Lightpanda is allowed to attempt. Its
  // complement is exactly what Chromium must run, which is what lets
  // scripts/e2e-hybrid.mjs split the suite without a second list to keep in
  // sync. design.spec.ts is entirely `@layout`, so the whole file drops out
  // here without needing a `testIgnore`.
  grepInvert: /@layout|@browser-api/,
  // Lightpanda is beta: a crashed or wedged connection should surface as a
  // failure quickly rather than sit out Chromium's 60s budget.
  timeout: 30_000,
  // One: Lightpanda serves a single browser context at a time, so parallel
  // workers against one `serve` collide on `Target.createBrowserContext`.
  // (Scaling this would mean one Lightpanda process per worker, on its own
  // port — not worth it while pages load in ~100ms.)
  workers: 1,
  fullyParallel: false,
  projects: [{ name: "lightpanda" }],
  use: {
    ...base.use,
    ...(appPort ? { baseURL: `http://127.0.0.1:${appPort}` } : {}),
    // No channel/devices spread: nothing is launched locally. The browser is
    // the CDP server below, reached by the `browser` fixture in
    // helpers/test-base.ts, which is what LIGHTPANDA_CDP switches on.
    trace: "off",
  },
  // Nothing at all when the runner owns the processes: it starts the app
  // server, the static preview and the browsers itself, in the order it needs.
  webServer: external
    ? []
    : [
        ...(Array.isArray(base.webServer) ? base.webServer : []),
        {
          command: `node scripts/install-lightpanda.mjs && ./.tools/lightpanda serve --host 127.0.0.1 --port ${CDP_PORT}`,
          cwd: ROOT,
          // `serve` speaks CDP over WebSocket but also answers the HTTP
          // discovery endpoint, which Playwright can poll for readiness.
          url: `http://127.0.0.1:${CDP_PORT}/json/version`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
