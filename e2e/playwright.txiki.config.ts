/**
 * The same e2e suite, against the txiki.js **single-file executable**
 * (`.txiki/shelly-devroom`, scripts/compile-txiki.mjs) instead of the Node
 * server.
 *
 * The two runtimes share every route but not their builder: `#devroom/builder`
 * resolves to `node-builder-entry.ts` (shells out to `tsc`) under Node and to
 * `txiki-builder-entry.ts` (type-checks in process) under txiki, so a UI
 * behaviour that reads a build/check payload can pass on one and fail on the
 * other. Running the whole suite twice is what catches that.
 *
 * Own port (`DEVROOM_PORT`, server/core/config.ts) so it never reuses — or
 * fights — a dev server on the default 8787. `reuseExistingServer: false`:
 * silently testing something already listening would defeat the point.
 */
import { defineConfig } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import base from "./playwright.config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}`;

const servers = Array.isArray(base.webServer)
  ? base.webServer
  : base.webServer
    ? [base.webServer]
    : [];
/** The static-preview server from the base config: unchanged, and addressed by
 * absolute URL from e2e/static.spec.ts, so it is runtime-independent. */
const staticServer = servers.slice(1);

export default defineConfig({
  ...base,
  // One worker, unlike the Node config's four: txiki.js runs one event loop and
  // its builder type-checks *in process*, so four browsers each triggering a
  // Build/Check at once serialize behind each other and blow the per-assertion
  // timeouts. What this suite is for is the runtime's behaviour, not its
  // concurrency.
  workers: 1,
  use: { ...base.use, baseURL: BASE },
  webServer: [
    {
      // Same build prerequisites as the Node config (a dist/ older than
      // scripts/main.ts trips `artifacts-stale` and moves the check panel),
      // plus the compile step that produces the executable under test.
      command:
        "npm run build:shelly && npm run build:web && npm run build:txiki:executable && ./.txiki/shelly-devroom",
      cwd: ROOT,
      url: BASE,
      env: { DEVROOM_PORT: String(PORT) },
      reuseExistingServer: false,
      timeout: 300_000,
    },
    ...staticServer,
  ],
});
