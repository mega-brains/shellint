/**
 * The `test` object every spec imports, instead of `@playwright/test` directly.
 *
 * Default (no `LIGHTPANDA_CDP`): a verbatim re-export — the Chromium runs are
 * unaffected by this file existing.
 *
 * With `LIGHTPANDA_CDP` set (e2e/playwright.lightpanda.config.ts), the browser
 * becomes a running `lightpanda serve`, reached over CDP. Playwright has no
 * config-level hook for that — `use.connectOptions` speaks Playwright's own
 * protocol, not CDP — so `chromium.connectOverCDP` has to happen in a fixture,
 * which is why the specs import from here rather than from the package.
 *
 * The three overrides below are each a workaround for a measured Lightpanda
 * limit, not a preference; see the comment on each.
 */
import { expect, test as base, type Browser } from "@playwright/test";

const endpoint = process.env.LIGHTPANDA_CDP;

export const test = endpoint
  ? base.extend<object, { browser: Browser }>({
      // `browser.close()` on a CDP connection disconnects this client; it does
      // not stop the Lightpanda process, which Playwright's `webServer` owns.
      browser: [
        async ({}, use) => {
          // Imported here, not at module scope: this file is on the import
          // path of every spec, and pulling the `playwright` package into all
          // four Chromium workers costs real startup time for a branch they
          // never take.
          const { chromium } = await import("playwright");
          const browser = await chromium.connectOverCDP(endpoint);
          await use(browser);
          await browser.close();
        },
        { scope: "worker" },
      ],

      // The context Playwright adopts from the CDP connection, never a fresh
      // one. Two reasons, both hard limits:
      //
      //   - Lightpanda serves exactly one browser context at a time
      //     ("Cannot have more than one browser context at a time"), so
      //     per-test contexts would have to be torn down in lockstep anyway —
      //     and the config runs a single worker for the same reason.
      //   - Playwright Test injects `locale: "en-US"` into every context it
      //     creates (setting `use.locale` to undefined does not suppress it)
      //     and then sends `Emulation.setLocaleOverride`, which Lightpanda
      //     answers `UnknownMethod` — failing every test at `newPage`. An
      //     adopted context carries no such options.
      //
      // Isolation therefore comes from the page, not the context: each test
      // still gets its own, and openApp() clears localStorage through an init
      // script. Cookies are not cleared between tests — Lightpanda has no
      // `Storage.clearCookies` — which is harmless here because the app sets
      // none.
      context: async ({ browser }, use) => {
        const context = browser.contexts()[0] ?? (await browser.newContext());
        await use(context);
      },

      // `baseURL` is a context option, and the adopted context above has no
      // options — so `page.goto("/")` reaches Lightpanda as the literal "/"
      // and comes back `Page.navigate: TypeError`. Resolving it here keeps the
      // specs written against `baseURL` the way the Chromium configs expect.
      page: async ({ context, baseURL }, use) => {
        const page = await context.newPage();
        const goto = page.goto.bind(page);
        page.goto = (url, options) =>
          goto(baseURL ? new URL(url, baseURL).href : url, options);
        await use(page);
        await page.close();
      },
    })
  : base;

export { expect };
export type { Locator, Page } from "@playwright/test";
