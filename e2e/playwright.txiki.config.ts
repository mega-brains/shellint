/**
 * The same e2e suite, against the txiki.js **single-file executable**
 * (`.txiki/shellint`, scripts/compile-txiki.mjs) instead of Node
 * server.
 *
 * Two runtimes share routes but not builder: `#shellint/builder`
 * resolves to `node-builder-entry.ts` (shells out to `tsc`) under Node and to
 * `txiki-builder-entry.ts` (type-checks in process) under txiki, so a UI
 * behaviour that reads a build/check payload can pass on one and fail on the
 * other. Running the whole suite twice is what catches that.
 *
 * Own port (`SHELLINT_PORT`, server/core/config.ts) so it never reuses — or
 * fights — a dev server on the default 8787. `reuseExistingServer: false`:
 * silently testing something already listening would defeat the point.
 */
import { defineConfig } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import base, { NO_DEVICE_ENV } from "./playwright.config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  ...base,
  // static.spec.ts is the one spec this leg has nothing to say about: it
  // addresses the static preview server by absolute URL and never touches the
  // server under test, so running it here re-asserts the base config's
  // findings against identical bytes — and pays for the second webServer
  // (`build:static` + preview) to do it. The base config still runs it once.
  testIgnore: ["**/static.spec.ts"],
  // One worker, unlike the Node config's four: txiki.js runs one event loop and
  // its builder type-checks *in process*, so four browsers each triggering a
  // Build/Check at once serialize behind each other and blow the per-assertion
  // timeouts. What this suite is for is the runtime's behaviour, not its
  // concurrency.
  workers: 1,
  use: { ...base.use, baseURL: BASE },
  webServer: [
    {
      // Same build prerequisites as the Node config (a dist/ older than the
      // script trips `artifacts-stale` and moves the check panel), plus the
      // compile step that produces the executable under test. Its own fixture
      // workspace, so it can run back to back with the Node suite.
      command:
        "node scripts/build-fixture.mjs e2e-txiki && npm run build:web && npm run build:txiki:executable && ./.txiki/shellint",
      cwd: ROOT,
      url: BASE,
      env: {
        SHELLINT_PORT: String(PORT),
        SHELLINT_SCRIPT: ".tmp/e2e-txiki/main.ts",
        SHELLINT_DIST: ".tmp/e2e-txiki/dist",
        ...NO_DEVICE_ENV,
      },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
