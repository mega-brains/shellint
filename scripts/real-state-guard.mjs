/**
 * Shared net for the test modules that overwrite real developer state —
 * `.shellint/devices.json` (the device list *and* its plaintext passwords),
 * `shellint.json`, `scripts/main.ts`, the `types/` mirrors. None of it is
 * recoverable: devices.json is gitignored, and the fixture each module writes
 * over it is empty.
 *
 * Those modules wrap their body in `try/finally { restore() }`, which only
 * covers a failed assertion if the assertion *throws* — `process.exit` skips
 * `finally`, so `fail()` must never exit. `restoreOnExit` covers what `finally`
 * cannot see: an uncaught crash, a `process.exit` from library code, or a
 * Ctrl-C mid-run.
 * Usage: paired with the caller's own `finally`, see test-devices.mjs.
 */

/**
 * Thrown by a module's `fail()`. Distinguishable so a `catch` placed around the
 * code under test can re-throw the assertion instead of swallowing it into a
 * pass — `test-probe-store.mjs`'s bare `catch` would otherwise do exactly that.
 */
export class AssertionFailed extends Error {}

/** Node's conventional exit codes for a process killed by these signals. */
const SIGNAL_EXITS = [
  ["SIGINT", 130],
  ["SIGTERM", 143],
];

/**
 * Registers `restore` on process exit and on SIGINT/SIGTERM, and returns a
 * run-at-most-once wrapper for the caller's `finally` — so the normal path
 * restores exactly once and the net is a no-op. `restore` must be synchronous:
 * an `exit` handler cannot await.
 */
export function restoreOnExit(restore) {
  let restored = false;
  const once = () => {
    if (restored) return;
    restored = true;
    restore();
  };
  process.once("exit", once);
  for (const [signal, code] of SIGNAL_EXITS) {
    process.once(signal, () => {
      once();
      process.exit(code);
    });
  }
  return once;
}
