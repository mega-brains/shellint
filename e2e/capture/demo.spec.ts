/**
 * The **footage** for the M40 tour video — `.github/assets/shellint-tour.{mp4,webm}`,
 * superseded by `anim.spec.ts`'s cut and kept runnable. The landing hero and the
 * README now ship that one instead.
 *
 * This spec no longer produces a finished video. It produces raw UI footage
 * plus a beat manifest; `video/` (Remotion) cuts them into the product video,
 * adding the title card, the chapter titles, the window frame, the transitions
 * and the outro. The division is deliberate: the *zoom* stays here, because a
 * CSS transform on `#app` re-renders the page at scale and is genuinely
 * sharper, where the same move in Remotion would be an upscale of pixels that
 * were already captured. Everything that is drawn *over* the footage moved out.
 *
 * Not part of the gate (`e2e/playwright.config.ts` ignores `capture/**`): this
 * drives the UI for ~60 s and writes a file instead of asserting. Run it with
 * `mise run capture:video`, which shoots this spec into `.tmp/capture/demo.webm`
 * and then hands that intermediate to `scripts/normalize-capture.mjs` and
 * `scripts/render-remotion-video.mjs`.
 *
 * **A capture, not a screen recording.** The working rule in CLAUDE.md — never
 * point verification at a live device — holds for marketing capture too. Every
 * device call here is intercepted by `mockDeviceApis`, the script is the
 * fixture workspace, and `SHELLINT_NO_DEVICE` is set by the config this
 * inherits. Nothing below can reach hardware, and a re-shoot is one command
 * rather than a session someone has to perform again.
 *
 * Beat order mirrors `TOUR` in `web/site/landing.tsx` — with one deliberate
 * exception, beat 3. The landing tour's rows are UI *regions*, each illustrated
 * by a crop cut out of the hero screenshot; the hero does not show the check
 * pane, so there is no rectangle for `scripts/crop-docs-figures.mjs` to cut and
 * no row for this beat. The other five keep their one-to-one mapping.
 *
 *   0  cold open      the app, settled, nothing moving
 *   1  toolbar        device and slot in the header, run state toggled live
 *   2  rail           an edit goes stale, build + check takes it to 66/66
 *   3  checks-run     broken code pasted in, Build + Check runs
 *   4  checks-read    the eight findings, then the rule roll-up
 *   -  checks-reset   undone and green again — captured, never shown
 *   5  artifacts      debug.raw → prod.min → the debug ↔ prod diff
 *   6  inspector      sizes against caps, counters, RAM estimate vs peak
 *   7  dock           device telemetry, then a streamed log charting a #m series
 *
 * Beat 0 is shot at zoom 1, on the same settled app `e2e/capture/header.spec.ts`
 * shoots the hero PNG from (`openSettled` in `e2e/helpers/settled-app.ts`). It
 * is no longer the video's poster — the composition opens on a title card, so
 * the poster is rendered out of Remotion instead — but keeping the two captures
 * on one readiness gate is still what stops the site's still and its video
 * showing two different apps.
 */
import { test, type Page } from "../helpers/test-base";
import { expect } from "@playwright/test";
import { CAPTURE_VIEWPORT, openSettled } from "../helpers/settled-app";
import { resetZoomState, resetZoom, zoomTo } from "../helpers/capture-zoom";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(ROOT, ".tmp", "capture");
const OUT = join(OUT_DIR, "demo.webm");
const MANIFEST = join(OUT_DIR, "demo.beats.json");

/** ~60 s of driving plus app boot and three real build+checks of the fixture. */
const SPEC_TIMEOUT = 300_000;

/**
 * The beat manifest — the contract between this spec and `video/`.
 *
 * This capture carries **no captions and no titles** any more: it is raw
 * footage. `video/` (Remotion) draws the chapter titles, the lower thirds, the
 * window frame and the transitions, at a size chosen against a 1920×1080
 * canvas rather than against this 1620-wide viewport.
 *
 * Which means the composition needs to know where each beat starts and ends in
 * the footage — and that has to be *measured*, not typed, or every pacing tweak
 * below silently desyncs the video. Each beat records its span in milliseconds
 * from the moment the screencast started; `scripts/normalize-capture.mjs` turns
 * the file into constant 30 fps and writes the frame numbers into
 * `video/src/beats.generated.ts`.
 */
type Beat = { index: number; key: string; startMs: number; endMs: number };
const beats: Beat[] = [];

/**
 * The code the checks beat pastes in — deliberately broken, and broken in a
 * *measured* way. Run through the real tiers before a frame was shot, it trips
 * eight findings from three of them:
 *
 *   no-registration-in-loop   error   caps
 *   timer-period-min          error   semantics
 *   no-call-in-loop           error   semantics
 *   check-call-error-code     warn    semantics
 *   no-debug-log-in-prod ×2   warn    advisories
 *   no-concat-in-loop         warn    advisories
 *   prefer-hoisted-callback   warn    advisories
 *
 * Two properties it was chosen for, both easy to lose in an edit:
 *
 * - **It compiles.** Every finding is a lint result, not a syntax or type
 *   error. A parse failure marks all 66 rules but one `skipped`
 *   (`server/lint/check-catalog.ts`), which is the opposite of the point, and
 *   it would break the build the artifact and size chapters after this one are
 *   shot against.
 * - **Nothing here is device-specific**, so it lints identically against the
 *   fixture workspace with no hardware anywhere near the capture.
 *
 * If one of those eight rules is ever renamed or retuned, this chapter quietly
 * shows fewer findings — hence the list above, so a `git grep` for the old rule
 * name lands here.
 *
 * **Pasted, not typed.** `web/editor/cm-setup.ts` runs `closeBrackets()`,
 * `indentOnInput()` and `autocompletion()`; typed through `keyboard.type` this
 * comes out with doubled braces, re-indented bodies and completion popups. A
 * clipboard paste inserts it verbatim — and reads on camera as what it is,
 * code someone else handed you.
 */
const BAD_CODE = [
  "",
  "function report(rows: string[]): string {",
  '  let out = "";',
  "  for (let i = 0; i < rows.length; i++) {",
  '    out = out + rows[i] + ", ";',
  '    console.log("row " + i);',
  "  }",
  "  return out;",
  "}",
  "",
  "for (let i = 0; i < 8; i++) {",
  "  Timer.set(5, true, function () {",
  '    Shelly.call("Switch.Set", { id: 0, on: true }, function (res, code, msg) {',
  '      print(report(["a", "b"]));',
  "    });",
  "  });",
  "}",
].join("\n");

/** Wall clock at the first captured frame; every beat's span is relative to it. */
let t0 = 0;

/** Elapsed-time log, so a re-shoot can be re-paced without watching it twice. */
function mark(label: string) {
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${label}`);
}

/**
 * One beat: run its actions, hold whatever they produced on screen for a
 * moment, and record the span it occupied in the footage.
 *
 * Actions are separated by explicit waits rather than raced — the point of the
 * video is that a viewer can follow what changed, and Playwright's own pacing
 * is far faster than anyone can read.
 *
 * The holds are shorter than they were when this spec burned its own captions
 * in: a caption that has to be read while the UI sits still needs dead air at
 * the end of a beat, and a Remotion lower third that fades in over the action
 * does not.
 */
async function beat(page: Page, key: string, hold: number, run: () => Promise<void>) {
  const startMs = Date.now() - t0;
  try {
    await run();
    await page.waitForTimeout(hold);
  } finally {
    beats.push({ index: beats.length, key, startMs, endMs: Date.now() - t0 });
    mark(`beat ${beats.length - 1} done — ${key}`);
  }
}

test.describe("showcase video", () => {
  test.use({ viewport: CAPTURE_VIEWPORT });
  test.describe.configure({ timeout: SPEC_TIMEOUT });

  test("six-chapter cut", { tag: "@layout" }, async ({ page }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    resetZoomState();
    await openSettled(page, "dark");
    // openSettled installs a fixed clock, which stays *paused* until this call
    // — good for a still, wrong for a video: the device poll, the log poll and
    // the editor's own cursor all need time to pass. Resume, so time flows
    // normally from a reproducible epoch rather than from "now".
    await page.clock.resume();
    // Fail fast rather than eating the whole test budget: with no per-action
    // timeout, one mis-aimed push-in leaves an element outside the frame and
    // Playwright waits on it silently until the spec times out four minutes
    // later, reporting the `finally` block instead of the beat that broke.
    page.setDefaultTimeout(20_000);

    // The checks beat pastes its snippet through the clipboard (see BAD_CODE),
    // which headless Chromium refuses without this.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.screencast.start({ path: OUT, size: CAPTURE_VIEWPORT });
    // Immediately after start() and before anything else: every millisecond
    // between the first captured frame and `t0` is an offset the manifest
    // cannot see, and the manifest is what aligns the composition's chapters
    // with the footage.
    t0 = Date.now();
    // Playwright videos have no pointer otherwise; "pointer" draws one that
    // animates from the previous action point to the next, which is what makes
    // a click legible without a caption explaining it.
    //
    // `fontSize: 1` is how the *title* half of the same decoration is turned
    // off. There is no flag for it: `showActions` draws both a cursor and a
    // label naming the action, and the label says things like
    // `Press "ControlOrMeta+End"` — Playwright's vocabulary, burned into
    // marketing footage, in the corner where chapter 03's artifact chips are.
    // A one-pixel label is invisible; `duration: 1` would have hidden it too
    // but takes the cursor with it.
    await page.screencast.showActions({ cursor: "pointer", duration: 700, fontSize: 1 });

    const GATES = [
      '[data-testid="gate-built"]',
      '[data-testid="gate-checked"]',
      '[data-testid="gate-probed"]',
    ];

    try {
      // ---------------------------------------------------- 0 · cold open
      // No zoom: the whole workspace, before anything is asked of the viewer.
      // Short, because the composition's title card now carries the opening —
      // this is the establishing shot behind the first chapter title, not a
      // pause the viewer has to sit through.
      await beat(page, "cold-open", 0, async () => {
        await page.waitForTimeout(1_400);
      });

      // ------------------------------------------------------- 1 · toolbar
      await beat(page, "toolbar", 400, async () => {
        // Everything this beat touches is in the left half of the header, so
        // one push-in covers the picker, the slot and the run chip.
        await zoomTo(page, ["#configLine", ".chip-run"], 2.4);
        await page.locator("#deviceSelect").hover();
        await page.waitForTimeout(650);
        await page.locator("#slotSelect").hover();
        await page.waitForTimeout(650);
        // The run-state chip is a real control: this POSTs /api/device/script
        // (intercepted) and the header re-reads status, so the stop/start is
        // the app's own state change, not a staged one.
        const runChip = page.locator(".chip-run");
        await runChip.click();
        await expect(runChip).toHaveClass(/run-stopped/, { timeout: 15_000 });
        await page.waitForTimeout(800);
        await runChip.click();
        await expect(runChip).toHaveClass(/run-running/, { timeout: 15_000 });
      });

      // ---------------------------------------------------------- 2 · rail
      //
      // Three moves, because the gate that goes stale and the button that
      // clears it are 1100 px apart: no single push-in holds both at a scale
      // worth having. Stale → act → green reads better as a move anyway.
      await beat(page, "rail", 450, async () => {
        // Typing happens at full width — the edit is the setup, not the point.
        await resetZoom(page);
        await page.locator("#editor .cm-content").click();
        await page.keyboard.press("ControlOrMeta+End");
        await page.keyboard.type("\n// one more line — the rail notices", { delay: 30 });
        await zoomTo(page, GATES, 2.3);
        await expect(page.getByTestId("gate-built")).toContainText("not built", {
          timeout: 10_000,
        });
        await page.waitForTimeout(1_100);
        await zoomTo(page, ["#btnSave", "#btnBuildMenu"], 2.3);
        await page.locator("#btnSave").click();
        await page.waitForTimeout(500);
        await page.locator("#btnBuildMenu").click();
        await page.waitForTimeout(500);
        await page.locator('#buildMenu button[data-action="both"]').click();
        await zoomTo(page, GATES, 2.3);
        await expect(page.getByTestId("gate-built")).not.toContainText("not built", {
          timeout: 60_000,
        });
        await expect(page.getByTestId("gate-checked")).not.toContainText("not checked", {
          timeout: 60_000,
        });
      });

      // -------------------------------------------------------- 3 · checks
      //
      // The one chapter that puts something *wrong* on screen — see BAD_CODE
      // for the eight findings it trips.
      //
      // Three beats, not one, because they want three different speeds:
      //
      //   checks-run    paste, save, Build + Check. Mostly a real build running
      //                 — ~11 s of progress state that the composition plays
      //                 fast.
      //   checks-read   the findings list and the rule roll-up. Prose in a
      //                 narrow column: this is the one span that must play at
      //                 1× or nobody can read it.
      //   checks-reset  undo, rebuild, back to 66/66. **Captured and never
      //                 shown.** It exists so chapters 04–06 — artifact sizes,
      //                 RAM, telemetry — are not shot over a script that fails
      //                 its own check, which would undercut every number in
      //                 them. Nothing in `video/` references this beat.
      await beat(page, "checks-run", 0, async () => {
        await resetZoom(page);
        await page.locator("#editor .cm-content").click();
        await page.keyboard.press("ControlOrMeta+End");
        await page.keyboard.press("Enter");
        // Pasted, not typed: see BAD_CODE.
        await page.evaluate((text) => navigator.clipboard.writeText(text), BAD_CODE);
        await page.keyboard.press("ControlOrMeta+V");
        await page.waitForTimeout(900);

        await page.locator("#btnSave").click();
        await page.waitForTimeout(400);
        await page.locator("#btnBuildMenu").click();
        await page.waitForTimeout(400);
        await page.locator('#buildMenu button[data-action="both"]').click();

        // The check tab, not the build tab: the badge on it carries the failure
        // count, so opening it is itself part of what the beat is showing.
        await page.getByTestId("tab-check").click();
        await expect(page.locator("#findingsList li.finding").first()).toBeVisible({
          timeout: 60_000,
        });
      });

      await beat(page, "checks-read", 400, async () => {
        // Park the pointer before pushing in — `web/ui/option-tip.tsx` portals
        // its tip to document.body, outside the transformed `#app`, so a tip
        // opened under a push-in floats away from the row it belongs to.
        await page.mouse.move(40, 500);
        // The findings are a narrow column of prose in the inspector — the
        // most aggressive push-in in the cut, and the one most able to put its
        // own target out of frame. Aimed at the list, which is what the
        // chapter is named after.
        await zoomTo(page, "#findingsBlock", 2.0);
        await page.waitForTimeout(2_600);
        const findings = page.locator("#findingsList");
        await findings.evaluate((el) => el.scrollTo({ top: 260, behavior: "smooth" }));
        await page.waitForTimeout(1_600);
        // Then the roll-up: which of the 66 rules failed, not just what they
        // said. `rule tiers` is `defaultCollapsed` (web/check/check-panel.tsx),
        // so `#checkRules` does not exist until its group toggle is pressed —
        // aiming a push-in at it first is twenty seconds of Playwright waiting
        // for a box that is never coming.
        await resetZoom(page);
        await page.locator("#tiersBlock .group-toggle").click();
        await expect(page.locator("#checkRules")).toBeVisible({ timeout: 10_000 });
        await page.mouse.move(40, 500);
        await zoomTo(page, "#checkRules", 1.7);
        await page.waitForTimeout(2_400);
      });

      await beat(page, "checks-reset", 0, async () => {
        await resetZoom(page);
        await page.locator("#editor .cm-content").click();
        for (let i = 0; i < 12; i++) await page.keyboard.press("ControlOrMeta+Z");
        await page.locator("#btnSave").click();
        await page.waitForTimeout(400);
        await page.locator("#btnBuildMenu").click();
        await page.waitForTimeout(400);
        await page.locator('#buildMenu button[data-action="both"]').click();
        await zoomTo(page, GATES, 2.3);
        await expect(page.getByTestId("gate-checked")).toContainText("66/66", {
          timeout: 60_000,
        });
      });

      // ----------------------------------------------------- 4 · artifacts
      await beat(page, "artifacts", 450, async () => {
        // Aimed at the chips rather than the whole strip: the strip runs the
        // width of the editor, and framing all of it would zoom out to nothing.
        // The swapped-in artifact then fills the frame beneath them.
        await zoomTo(page, ['.artifact-chip[data-value="source"]', ".artifact-diff"], 1.8);
        for (const value of ["debug.raw.js", "prod.js"]) {
          await page.locator(`.artifact-chip[data-value="${value}"]`).click();
          await expect(page.locator("#artifactMeta")).toContainText("B", {
            timeout: 15_000,
          });
          await page.waitForTimeout(1_300);
        }
        // The diff is the last entry of the strip's split button: what the
        // meta.env gating actually removed, debug ↔ prod, in the editor.
        await page.locator(".artifact-diff .artifact-chip").click();
        await page.waitForTimeout(500);
        await page.locator('#diffMenu button[data-value="diff:debug↔prod"]').click();
        await page.waitForTimeout(1_800);
        await page.locator('.artifact-chip[data-value="source"]').click();
      });

      // ----------------------------------------------------- 5 · inspector
      await beat(page, "inspector", 450, async () => {
        await resetZoom(page);
        await page.getByTestId("tab-build").click();
        // Park the pointer off the panel first. `web/ui/option-tip.tsx`
        // appends its tip to `document.body` — outside the transformed `#app`
        // — so a tip opened under a push-in is positioned in unscaled
        // coordinates and floats away from the counter it belongs to.
        await page.mouse.move(40, 500);
        await page.waitForTimeout(500);
        // The inspector is a narrow column of numbers — the one region of the
        // UI that is unreadable at hero size without a push-in. Taller than
        // any useful scale, so this one is centred and scrolled, not fitted.
        await zoomTo(page, "#side", 1.9);
        const side = page.locator("#side");
        for (const top of [180, 360, 540]) {
          await side.evaluate((el, y) => el.scrollTo({ top: y, behavior: "smooth" }), top);
          await page.waitForTimeout(850);
        }
        await side.evaluate((el) => el.scrollTo({ top: 0, behavior: "smooth" }));
      });

      // ---------------------------------------------------------- 6 · dock
      await beat(page, "dock", 600, async () => {
        // Expanded at full width: the dock taking its own row out of the
        // workspace is part of what the beat is showing.
        await resetZoom(page);
        await page.locator("#dockToggle").click();
        await expect(page.locator("#deviceGrid")).toBeVisible({ timeout: 10_000 });
        // Aimed at the dock's tab strip, which sits at the far left — the
        // dock element itself is full width, and centring on it is what put
        // these two tabs outside the frame in the first cut.
        await zoomTo(page, ["#deviceHead", "#logsHead"], 1.5);
        await page.waitForTimeout(1_400);
        await page.locator("#logsHead").click();
        await page.waitForTimeout(500);
        await page.locator("#btnLogs").click();
        // The mocked stream carries a `#m cpu` line, so the chart is the real
        // renderer over real (if canned) series data.
        await expect(page.locator("#logsList li").first()).toBeVisible({
          timeout: 20_000,
        });
        await page.waitForTimeout(1_400);
      });

      // Tail: pull all the way back out, so the last chapter ends on the whole
      // workspace rather than mid-push-in, and the composition's outro has
      // something calm to fade from.
      await resetZoom(page);
      await page.waitForTimeout(700);
      mark("cut complete");
    } finally {
      await page.screencast.stop();
      // Written whatever happened: a run that died in beat 4 still leaves four
      // usable beats, and a manifest describing exactly what is in the file
      // beats one describing what was meant to be.
      writeFileSync(MANIFEST, `${JSON.stringify(beats, null, 2)}\n`);
    }

    console.log(`wrote ${OUT}`);
    console.log(`wrote ${MANIFEST} (${beats.length} beats)`);
  });
});
