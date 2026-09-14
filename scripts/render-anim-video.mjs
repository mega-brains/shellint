/**
 * Encode the composed product video out of the frames `e2e/capture/anim.spec.ts`
 * shot, into the three files the landing hero and the README ship:
 *
 *   .github/assets/shellint-anim.mp4          h264, the file every visitor loads
 *   .github/assets/shellint-anim.webm         vp9, the codec fallback
 *   .github/assets/shellint-anim-poster.png   the hero's `poster`
 *
 * The M40 tour (`shellint-tour.{mp4,webm}` + its poster) and the M39 cut
 * (`shellint-demo.*`) are **left alone**: both stay tracked in `.github/assets/`
 * and stop being referenced by the site and the README. Nothing here writes or
 * deletes either.
 *
 * Input is `.tmp/capture/anim/` — `frames/frame-NNNNN.png` plus `meta.json`,
 * both written by the capture spec. The frame rate comes out of `meta.json`
 * rather than being repeated here, so a re-paced capture cannot desync from its
 * own encode.
 *
 * ## Why ffmpeg directly and not the `video/` Remotion pipeline
 *
 * That pipeline exists to *compose* — titles and chapter timing over raw
 * screencast footage. This source is already a finished 1920x1080 composition
 * with its own captions, so there is nothing left to cut: the whole job is
 * PNG sequence in, two encodes out. Pulling in Remotion's ~350 MB to do that
 * would buy nothing.
 *
 * ## The size ceiling
 *
 * `SITE_MEDIA_BUDGET` lives in `scripts/site-budgets.mjs` next to the two
 * bundle budgets and is asserted twice: over `site/` by
 * `scripts/test-static-bundle.mjs`, and here the moment the mp4 exists — a
 * re-render that doubles the landing's weight has to fail at the render, not
 * three commits later on someone else's machine. It is checked between the two
 * encodes because VP9 is by far the slower of them and encodes the same frames:
 * an over-budget cut is over budget before that pass starts.
 *
 * If a re-render breaches it, cut a scene out of the composition rather than
 * raising the CRF — blurry text in a tool whose subject is code reads worse
 * than a shorter video.
 *
 * Usage: node scripts/render-anim-video.mjs
 *        (or `mise run capture:anim`, which shoots the frames first)
 */
import { existsSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SITE_MEDIA_BUDGET } from "./site-budgets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURE = join(ROOT, ".tmp", "capture", "anim");
const FRAMES = join(CAPTURE, "frames");
const PATTERN = join(FRAMES, "frame-%05d.png");
const ASSETS = join(ROOT, ".github", "assets");
const MP4 = join(ASSETS, "shellint-anim.mp4");
const WEBM = join(ASSETS, "shellint-anim.webm");
const POSTER = join(ASSETS, "shellint-anim-poster.png");

/**
 * 37 s in, inside the telemetry scene — the fullest frame in the cut: the
 * script typed out, all four artifacts sized, the counters and memory buckets
 * populated, the dock open with live tiles and a log stream.
 *
 * Deliberately not the opening (a wordmark on an empty shell) and not a frame
 * from the first half (the editor is still typing and the inspector is still
 * empty): the poster is what a visitor stares at before the video decodes, and
 * on a slow connection it may be all they ever see.
 */
const POSTER_TIME = 37;

/**
 * Tuned against SITE_MEDIA_BUDGET on the 45 s / 1350-frame cut: 2.47 MB h264,
 * comfortably inside the 4 MB ceiling.
 *
 * The two scales are not comparable — libvpx-vp9's CRF runs 0–63 where x264's
 * runs 0–51 — and they were picked so the webm lands *near* the mp4 rather than
 * at matched quality: at 36 it encoded to 4.6 MB, nearly twice the h264 file,
 * for a fallback that only a browser which cannot decode High-profile H.264
 * ever downloads.
 */
const H264_CRF = "30";
const VP9_CRF = "46";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ffmpeg(label, args) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostats", "-y", ...args], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (r.error?.code === "ENOENT") fail("ffmpeg not found — `brew install ffmpeg`");
  if (r.status !== 0) fail(`ffmpeg ${label} failed (exit ${r.status})`);
}

if (!existsSync(join(CAPTURE, "meta.json")) || !existsSync(FRAMES)) {
  fail(
    "no capture in .tmp/capture/anim — shoot the frames first:\n" +
      "       pnpm run capture:anim:frames",
  );
}
const meta = JSON.parse(readFileSync(join(CAPTURE, "meta.json"), "utf8"));
const { fps, frames } = meta;
if (!fps || !frames) fail(`.tmp/capture/anim/meta.json is missing fps/frames: ${JSON.stringify(meta)}`);

mkdirSync(ASSETS, { recursive: true });

ffmpeg("h264", [
  "-framerate", String(fps),
  "-i", PATTERN,
  "-c:v", "libx264",
  "-crf", H264_CRF,
  "-preset", "slow",
  // Safari refuses anything with more chroma than 4:2:0.
  "-pix_fmt", "yuv420p",
  // Moves the moov atom to the front so the hero starts playing before the file
  // has finished downloading — above the fold, that is the entire point.
  "-movflags", "+faststart",
  "-an",
  MP4,
]);

const mp4Bytes = statSync(MP4).size;
console.log(`.github/assets/shellint-anim.mp4          ${mp4Bytes} B`);
if (mp4Bytes > SITE_MEDIA_BUDGET) {
  fail(
    `shellint-anim.mp4 is ${mp4Bytes} B, over its ${SITE_MEDIA_BUDGET} B ceiling — ` +
      "cut a scene out of e2e/capture/assets/shellint-anim.html rather than raising the CRF",
  );
}

ffmpeg("vp9", [
  "-framerate", String(fps),
  "-i", PATTERN,
  "-c:v", "libvpx-vp9",
  "-crf", VP9_CRF,
  "-b:v", "0",
  "-row-mt", "1",
  "-pix_fmt", "yuv420p",
  "-an",
  WEBM,
]);

// The poster is one of the captured frames, copied byte-for-byte — so it
// cannot drift from what plays, the same property the Remotion pipeline gets
// from rendering its still out of the same composition.
const posterFrame = Math.min(Math.round(POSTER_TIME * fps), frames - 1);
ffmpeg("poster", [
  "-i", join(FRAMES, `frame-${String(posterFrame).padStart(5, "0")}.png`),
  POSTER,
]);

console.log(`.github/assets/shellint-anim.webm         ${statSync(WEBM).size} B`);
console.log(`.github/assets/shellint-anim-poster.png   ${statSync(POSTER).size} B (frame ${posterFrame})`);
console.log("OK: product video encoded");
