/**
 * Screenshot-capture runner for `e2e/capture/` — the README/landing hero pair.
 *
 * Same server, mocks and browser as the gate config it extends; only the test
 * directory differs, and it writes PNGs instead of asserting them. Kept out of
 * `mise run beforeCommit` (the base config ignores `capture/**`) because a run
 * overwrites tracked images.
 */
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "./capture",
  testIgnore: undefined,
  // One at a time: both shots are viewport screenshots of the same app and
  // parallel workers only add scheduling noise to a two-test run.
  workers: 1,
  fullyParallel: false,
});
