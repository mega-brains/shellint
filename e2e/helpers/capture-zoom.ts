/**
 * The capture's push-in — shared state and the geometry behind it.
 *
 * Lifted out of `e2e/capture/demo.spec.ts` when the checks chapter pushed that
 * file past the 500-line limit `mise run check:lines` enforces. It is a clean
 * seam: everything here is about *where the camera looks*, and nothing in it
 * knows what a beat is.
 *
 * Only the capture uses it — `e2e/playwright.config.ts` ignores `capture/**`,
 * so no gate spec ever transforms the app under test.
 */
import type { Page } from "@playwright/test";
import { CAPTURE_VIEWPORT } from "./settled-app";

/** Push-in/pull-out duration, and the easing every move shares. */
const ZOOM_MS = 700;
const ZOOM_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * Dynamic zoom.
 *
 * The hero renders the 1620×908 capture into a ~620 px-wide box, where the
 * whole UI at once is a mosaic: nobody can read a gate pill or a byte count.
 * Each beat therefore pushes in on the region it is about.
 *
 * It is a **CSS transform on `#app`**, not an ffmpeg crop-and-scale: the page
 * re-renders at the new scale, so zoomed text is genuinely sharper rather than
 * an upscale of 1620-wide pixels. `body` is already `overflow: hidden`, so the
 * scaled-up app clips at the viewport with no scrollbars, and `#app` (rather
 * than `html`) is the target so Playwright's own caption and cursor overlays,
 * which live outside it, stay unscaled.
 *
 * Playwright reads element boxes through the transform, so clicks land where
 * the viewer sees them — but an element scrolled out of frame by a push-in is
 * *not* clickable. Every beat below either zooms to a region containing
 * everything it touches, or resets first.
 */
export type Zoom = { k: number; tx: number; ty: number };
const IDENTITY: Zoom = { k: 1, tx: 0, ty: 0 };
/** Page-space breathing room kept around a zoom's named targets. */
const ZOOM_PAD = 28;
let zoom: Zoom = IDENTITY;

/**
 * Reset the tracked zoom without touching the page.
 *
 * `zoom` is module state, so a second capture in the same worker would inherit
 * the last one's framing and aim every push-in from the wrong origin. The spec
 * calls this before it starts driving.
 */
export function resetZoomState() {
  zoom = IDENTITY;
}

async function applyZoom(page: Page, next: Zoom) {
  await page.evaluate(
    ({ k, tx, ty, ms, ease }) => {
      const app = document.getElementById("app");
      if (!app) throw new Error("#app missing — the zoom target moved");
      app.style.transformOrigin = "0 0";
      app.style.transition = `transform ${ms}ms ${ease}`;
      app.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    },
    { ...next, ms: ZOOM_MS, ease: ZOOM_EASE },
  );
  zoom = next;
  // The transition plus a beat of settle, so no action starts mid-move.
  await page.waitForTimeout(ZOOM_MS + 250);
  // Then take the transition property back off. Playwright's actionability
  // check waits for a target's bounding box to be identical across two frames,
  // and a `transform` transition still attached to an ancestor is enough to
  // keep it fractionally in motion — which fails as an unexplained "waiting for
  // element to be visible, enabled and stable" twenty seconds later, on a
  // button that is plainly on screen. Reapplied by the next move.
  await page.evaluate(() => {
    const app = document.getElementById("app");
    if (app) app.style.transition = "none";
  });
}

/**
 * One axis of the push-in: where to translate so `[c0, c1]` (page space) is
 * framed at scale `k` in a viewport `v` long.
 *
 * Centring alone is what broke the first cut. The app is left-heavy — dock
 * tabs, artifact chips and gate pills all sit near x = 0 — so centring on a
 * full-width element pushed exactly the controls a beat clicks off the left
 * edge, and Playwright then waited on an unclickable target until the test
 * timed out. So: centre, then, **when the span fits**, slide back until both
 * of its edges are inside the frame. A span too long to fit keeps the centred
 * value (`#side` is taller than any useful zoom; it gets scrolled, not
 * clicked). The final clamp keeps the frame inside the app itself, so a
 * push-in never reveals page background.
 */
function solveAxis(k: number, c0: number, c1: number, v: number): number {
  let t = v / 2 - (k * (c0 + c1)) / 2;
  if (k * (c1 - c0) + 2 * ZOOM_PAD <= v) {
    t = Math.max(t, v - ZOOM_PAD - k * c1);
    t = Math.min(t, ZOOM_PAD - k * c0);
  }
  return Math.min(0, Math.max(v - k * v, t));
}

/** The union of one or more elements' boxes, in untransformed page space. */
async function pageBox(page: Page, selectors: string[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const selector of selectors) {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`no box for ${selector} — cannot aim the zoom`);
    // boundingBox() is viewport space, i.e. already through the current
    // transform; undo it so a zoom can be aimed while another is in effect.
    x0 = Math.min(x0, (box.x - zoom.tx) / zoom.k);
    y0 = Math.min(y0, (box.y - zoom.ty) / zoom.k);
    x1 = Math.max(x1, (box.x + box.width - zoom.tx) / zoom.k);
    y1 = Math.max(y1, (box.y + box.height - zoom.ty) / zoom.k);
  }
  return { x0, y0, x1, y1 };
}

/**
 * Push in on `selectors` at scale `k`. Everything named stays in frame if it
 * can fit, so a beat may safely click whatever it aims at.
 */
export async function zoomTo(page: Page, selectors: string | string[], k: number) {
  const { width: vw, height: vh } = CAPTURE_VIEWPORT;
  const box = await pageBox(page, Array.isArray(selectors) ? selectors : [selectors]);
  await applyZoom(page, {
    k,
    tx: solveAxis(k, box.x0, box.x1, vw),
    ty: solveAxis(k, box.y0, box.y1, vh),
  });
}

export async function resetZoom(page: Page) {
  if (zoom.k === 1 && zoom.tx === 0 && zoom.ty === 0) return;
  await applyZoom(page, IDENTITY);
}
