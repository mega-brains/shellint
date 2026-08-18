/**
 * @title shellint test fixture — device script
 * @description Stand-in for scripts/main.ts in the build/test/e2e pipelines.
 *   Nothing in the gate may read the user's live script, so every parity,
 *   lint and screenshot assertion compiles *this* file instead.
 * @status fixture
 *
 * Rules for editing:
 *   - must stay lint-clean on Tier 1–5 (`scripts/test-smoke.mjs` asserts it),
 *   - must type-check under tsconfig.shelly.base.json (`noLib`, `types: []`),
 *   - must use only device-independent APIs (`sys`, `Shelly.GetDeviceInfo`,
 *     `Timer`) so Tier 4 stays green whatever device profile is mirrored,
 *   - must keep meta.env branches and a handful of log strings — that is what
 *     makes debug ≠ prod, raw ≠ min and dist/prod.logmap.json non-empty,
 *   - every console.log/print stays behind a `meta.env.debug` guard, or
 *     `no-debug-log-in-prod` fires and the fixture is no longer lint-clean.
 * Changing it changes the e2e design baselines; regenerate them with
 * `npx playwright test -c e2e/playwright.config.ts --update-snapshots`.
 */

const POLL_MS = 30000;
const LOG_PREFIX = "FIX: ";

let ticks = 0;
let lastUptime = -1;

function log(msg: string) {
  if (meta.env.debug) console.log(LOG_PREFIX + msg);
}

/** Sys status is a singleton on every Gen2/Gen3 device — no component index. */
function readUptime(): number {
  const st = Shelly.getComponentStatus("sys") as { uptime?: number } | null;
  if (!st || typeof st.uptime !== "number") {
    log("sys status unavailable");
    return -1;
  }
  return st.uptime;
}

function reportUptime(uptime: number) {
  if (uptime === lastUptime) return;
  lastUptime = uptime;
  log("uptime " + JSON.stringify(uptime));
  // Charted by the logs panel: "#m <series> <value>" is the metric form.
  if (meta.env.debug) print("#m uptime " + uptime);
}

function onDeviceInfo(result: unknown, code: number, message: string) {
  if (code !== 0) {
    log("device info failed " + code + " " + message);
    return;
  }
  const info = result as { id?: string; gen?: number } | null;
  if (!info) {
    log("device info empty");
    return;
  }
  log("device " + (info.id || "?") + " gen " + (info.gen || 0));
}

function tick() {
  ticks = ticks + 1;
  const uptime = readUptime();
  if (uptime >= 0) reportUptime(uptime);

  if (meta.env.debug && ticks % 10 === 0) {
    // Dropped from the prod build by the meta.env DCE pass — the size gap
    // between the two variants is what test.mjs asserts on.
    print(LOG_PREFIX + "alive " + ticks + " of " + POLL_MS + " ms polls");
  }
}

Shelly.call("Shelly.GetDeviceInfo", {}, onDeviceInfo);

const timerHandle = Timer.set(POLL_MS, true, tick);
if (!timerHandle) {
  log("timer refused");
} else {
  log("polling every " + POLL_MS + " ms");
}

tick();
