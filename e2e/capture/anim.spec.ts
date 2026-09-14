/**
 * Frame capture for the composed product video — `.github/assets/shellint-anim.*`.
 *
 * Not part of the gate: `e2e/playwright.config.ts` ignores `capture/**`, and
 * this file writes into `.tmp/` instead of asserting. Run it with
 * `mise run capture:anim` (`pnpm run capture:anim`), which encodes the frames
 * straight after through `scripts/render-anim-video.mjs`.
 *
 * ## What it is shooting
 *
 * Not the app. `assets/shellint-anim.html` is a self-contained authored
 * composition — a React/SVG drawing of the shell, ten named scenes over 45 s,
 * 1920×1080, dark — so unlike `demo.spec.ts` there is no server, no mock and no
 * device here. The whole page is the subject.
 *
 * ## Why frame-by-frame seeks rather than a screencast
 *
 * The composition renders as a pure function of one authored clock and exposes
 * a synchronous seek transport (`data-om-seek-to-time-frame` with
 * `detail.sync`, answered under `ReactDOM.flushSync`), so a screenshot taken
 * the moment the seek returns is exactly the frame at that time. That makes the
 * capture deterministic and independent of machine speed — the opposite of
 * `demo.spec.ts`, whose chapter 02 has to derive a playback rate because it
 * contains a real build. A screencast of this page would instead be paced by
 * whatever frame rate the capture machine managed.
 *
 * Two consequences worth knowing before editing:
 *
 * - **The stage auto-scales to the viewport.** Its `transform: scale(...)` is
 *   cleared once, after mount, so the element's box is its authored 1920×1080
 *   and a frame is captured at native resolution rather than resampled.
 * - **The duration is read off the page, never hardcoded here.** It is the sum
 *   of the scene list inside the HTML; re-timing a scene there changes the
 *   frame count without touching this file.
 */
import { expect, test } from "../helpers/test-base";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SOURCE = join(HERE, "assets", "shellint-anim.html");

const FPS = 30;
const OUT = join(ROOT, ".tmp", "capture", "anim");
const FRAMES = join(OUT, "frames");

/** The stage the composition marks as its one exportable root. */
const STAGE = "[data-om-exportable-video-with-duration-secs]";

test.describe("product video frames", () => {
  // Exactly the frame: the stage is pinned to the origin below, so the capture
  // is a viewport clip at whole pixels. An element screenshot instead lands on
  // the stage's flex-centred box, whose fractional top rounds out to a
  // 1920×1081 PNG — and libx264 rejects an odd height outright.
  test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

  test("shoot", { tag: "@capture" }, async ({ page }) => {
    // ~1350 screenshots plus the Babel pass the bundle runs on load.
    test.setTimeout(30 * 60_000);

    await page.goto(pathToFileURL(SOURCE).href);
    const stage = page.locator(STAGE);
    // The page unpacks and Babel-compiles itself before React mounts.
    await stage.waitFor({ timeout: 120_000 });

    const duration = await stage.evaluate((el) => {
      const style = (el as SVGElement).style;
      // Undo the fit scale and take the stage out of the page's centring flow:
      // at the origin, at its authored size, over everything else.
      style.transform = "none";
      style.position = "fixed";
      style.left = "0";
      style.top = "0";
      style.zIndex = "9999";
      style.boxShadow = "none";
      return Number(el.getAttribute("data-om-exportable-video-with-duration-secs"));
    });
    expect(duration).toBeGreaterThan(1);
    // No `sync` attribute means seeks land asynchronously and a screenshot can
    // catch a stale commit — fail loudly rather than ship torn frames.
    await expect(stage).toHaveAttribute("data-om-sync-seek", "true");

    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    expect(box).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 });
    const clip = { x: 0, y: 0, width: 1920, height: 1080 };

    rmSync(FRAMES, { recursive: true, force: true });
    mkdirSync(FRAMES, { recursive: true });

    // The last authored frame is the one before the loop seam, not `duration`
    // itself: the composition settles at `duration` and opens at 0, so both
    // would be the same picture and the loop would hold for two frames.
    const total = Math.round(duration * FPS);
    for (let i = 0; i < total; i += 1) {
      const time = i / FPS;
      await stage.evaluate(
        (el, t) =>
          el.dispatchEvent(
            new CustomEvent("data-om-seek-to-time-frame", {
              detail: { time: t, sync: true, playing: false },
            }),
          ),
        time,
      );
      await page.screenshot({
        path: join(FRAMES, `frame-${String(i).padStart(5, "0")}.png`),
        clip,
        animations: "disabled",
      });
    }

    // The encoder reads its frame rate from here rather than repeating the
    // constant, so a re-paced capture cannot desync from its own encode.
    writeFileSync(
      join(OUT, "meta.json"),
      `${JSON.stringify({ fps: FPS, frames: total, duration }, null, 2)}\n`,
    );
    console.log(`captured ${total} frames at ${FPS} fps (${duration}s) → ${FRAMES}`);
  });
});
