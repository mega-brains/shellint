import type { BuildAction } from "./toolbar";

/**
 * Sequences the toolbar's three build actions.
 *
 * The one non-obvious rule: when `build` fails, `check` still runs for the
 * "both" action. A TypeScript error fails the build *and* is reported by Check
 * as a `syntax-error`/`type-error` finding, so skipping Check would leave those
 * errors on the status line and the build gutter only, never in the check pane.
 * The build failure is rethrown afterwards, so the caller still reports it.
 */
export async function runBuildSequence(
  action: BuildAction,
  build: () => Promise<void>,
  check: () => Promise<unknown>,
): Promise<void> {
  if (action === "check") {
    await check();
    return;
  }
  try {
    await build();
  } catch (e) {
    if (action === "both") {
      await check().catch(() => {
        /* the build error below is the one worth reporting */
      });
    }
    throw e;
  }
  if (action === "both") await check();
}

/** Toolbar-driven overrides for one build run; every field falls back to state. */
export type BuildRunOptions = {
  action?: BuildAction;
  skipTypes?: boolean;
  showCheckProgress?: boolean;
};
