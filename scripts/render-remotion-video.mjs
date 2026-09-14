/**
 * Render the product video out of `video/` into the three files the landing
 * hero, the README and the release notes ship:
 *
 *   .github/assets/shellint-tour.mp4          h264, the file every visitor loads
 *   .github/assets/shellint-tour.webm         vp9, the codec fallback
 *   .github/assets/shellint-tour-poster.png   the hero's `poster`
 *
 * The M39 cut (`shellint-demo.{mp4,webm}` + its poster) is **left alone**: it
 * stays in `.github/assets/` and stops being referenced by the site, the README
 * and this script. Nothing here writes or deletes it.
 *
 * Input is `video/public/demo.source.mp4` plus `video/src/beats.generated.ts`,
 * both written by `scripts/normalize-capture.mjs` from the Playwright capture.
 *
 * ## Why this wrapper exists rather than three CLI lines in mise.toml
 *
 * The size ceiling. `SITE_MEDIA_BUDGET` lives in `scripts/site-budgets.mjs`
 * next to the two bundle budgets, and is asserted in two places: over `site/`
 * by `scripts/test-static-bundle.mjs`, and here, the moment the file is
 * produced. A re-render that doubles the landing's weight has to fail at the
 * render, not three commits later on someone else's machine.
 *
 * ## Why the poster is rendered rather than reused
 *
 * The M38 screencast used `.github/assets/shellint-header-dark.png` as its
 * poster, which worked because frame 1 of that video *was* the hero still.
 * Frame 1 of this one is a title card at a different aspect ratio, so the
 * poster is a still out of the same composition — same property, kept honest by
 * construction. `POSTER_FRAME` sits inside the title card, after the wordmark
 * has drawn and before the first cut.
 *
 * ## Why an ffmpeg pass after Remotion
 *
 * Only for `-movflags +faststart`, which Remotion does not expose: it moves the
 * moov atom to the front so the hero starts playing before the file has
 * finished downloading, which above the fold is the entire point. It is a
 * stream copy — no second encode, no quality cost.
 *
 * Usage: node scripts/render-remotion-video.mjs
 *        (or `mise run capture:video`, which shoots and normalizes first)
 */
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SITE_MEDIA_BUDGET } from "./site-budgets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VIDEO = join(ROOT, "video");
const ENTRY = join("src", "index.ts");
const COMPOSITION = "ShellintTour";
const ASSETS = join(ROOT, ".github", "assets");
const MP4 = join(ASSETS, "shellint-tour.mp4");
const WEBM = join(ASSETS, "shellint-tour.webm");
const POSTER = join(ASSETS, "shellint-tour-poster.png");

/** 1.5 s in: the title card, fully drawn, before the first transition. */
const POSTER_FRAME = 45;

/**
 * Quality, tuned against `SITE_MEDIA_BUDGET`. See §11 of
 * `.claude/plans/2026-09-09_39_remotion-product-video.md` for the measurements.
 *
 * If a re-render breaches the budget, cut a chapter rather than raising these:
 * blurry text in a tool whose subject is code reads worse than a shorter video.
 */
const H264_CRF = "33";
const VP9_CRF = "50";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function remotion(label, args) {
  const r = spawnSync("npx", ["remotion", ...args], {
    cwd: VIDEO,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (r.status !== 0) fail(`remotion ${label} failed (exit ${r.status})`);
}

if (!existsSync(join(VIDEO, "node_modules"))) {
  fail(
    "video/node_modules missing — install the video package first:\n" +
      "       mise run video:install\n" +
      "       (it is deliberately not part of `mise run install`: Remotion plus\n" +
      "        its headless Chrome is ~350 MB, and the gate never needs it)",
  );
}
if (!existsSync(join(VIDEO, "public", "demo.source.mp4"))) {
  fail(
    "video/public/demo.source.mp4 missing — shoot and normalize the capture first:\n" +
      "       mise run capture:clips",
  );
}
if (!existsSync(join(VIDEO, "src", "beats.generated.ts"))) {
  fail("video/src/beats.generated.ts missing — run `mise run capture:clips`");
}

mkdirSync(ASSETS, { recursive: true });

// Rendered beside the final name and moved into place by the faststart pass, so
// a failed render never leaves a half-written tracked asset behind.
const MP4_RAW = `${MP4}.raw.mp4`;

remotion("render (h264)", [
  "render", ENTRY, COMPOSITION, MP4_RAW,
  "--codec=h264",
  `--crf=${H264_CRF}`,
  // Not the default for h264 (which is already yuv420p) but stated anyway:
  // Safari refuses anything with more chroma than 4:2:0.
  "--pixel-format=yuv420p",
  "--log=error",
]);

const faststart = spawnSync(
  "ffmpeg",
  [
    "-hide_banner", "-loglevel", "error", "-nostats",
    "-y",
    "-i", MP4_RAW,
    "-c", "copy",
    "-movflags", "+faststart",
    "-an",
    MP4,
  ],
  { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] },
);
if (faststart.error?.code === "ENOENT") {
  // Not fatal to the video, but the hero would buffer before it played. Say so
  // rather than shipping a file that is quietly worse.
  console.warn("WARN: ffmpeg not found — shipping the render without +faststart");
  renameSync(MP4_RAW, MP4);
} else if (faststart.status !== 0) {
  fail(`ffmpeg failed rewriting the mp4 for faststart (exit ${faststart.status})`);
} else {
  spawnSync("rm", ["-f", MP4_RAW]);
}

// The budget is checked here, between the two renders, and not at the end.
// VP9 is by far the slowest step — ten minutes against the h264 pass's two —
// and it encodes the same frames, so an over-budget cut is over budget before
// it starts. Failing first costs the operator two minutes instead of twelve.
const mp4Bytes = statSync(MP4).size;
console.log(`.github/assets/shellint-tour.mp4          ${mp4Bytes} B`);
if (mp4Bytes > SITE_MEDIA_BUDGET) {
  fail(
    `shellint-tour.mp4 is ${mp4Bytes} B, over its ${SITE_MEDIA_BUDGET} B ceiling — ` +
      "cut a chapter out of video/src/ShellintTour.tsx rather than raising the CRF",
  );
}

remotion("render (vp9)", [
  "render", ENTRY, COMPOSITION, WEBM,
  "--codec=vp9",
  `--crf=${VP9_CRF}`,
  "--log=error",
]);

remotion("still (poster)", [
  "still", ENTRY, COMPOSITION, POSTER,
  `--frame=${POSTER_FRAME}`,
  "--image-format=png",
  "--log=error",
]);

console.log(`.github/assets/shellint-tour.webm         ${statSync(WEBM).size} B`);
console.log(`.github/assets/shellint-tour-poster.png   ${statSync(POSTER).size} B`);
console.log("OK: product video rendered");
