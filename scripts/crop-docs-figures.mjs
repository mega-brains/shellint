/*
 * Cuts the docs figures out of the two hero screenshots.
 *
 * The docs page illustrates a region of the UI at a time (toolbar, readiness
 * rail, artifact strip, inspector, device dock) rather than repeating the whole
 * hero. Those crops are derived, never shot: `mise run capture:header` produces
 * `.github/assets/shellint-header{,-dark}.png` at a fixed 1620x908 viewport, so
 * every region below is a stable rectangle in that image and re-running this
 * script after a capture is the whole refresh procedure.
 *
 * Cropping goes through macOS `sips` — the repo ships no image dependency, and
 * the capture step is macOS-only anyway (the tracked hero shots are the
 * `-darwin` baselines). Two `sips` quirks are worked around here: `--cropOffset`
 * is `top left`, and a crop as wide as the source is silently ignored, which is
 * why no rectangle below spans the full 1620 px.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, ".github", "assets");
const outDir = join(assets, "figures");

/** Rectangles in the 1620x908 hero, as `top left height width`. */
const FIGURES = [
  { name: "toolbar", top: 0, left: 10, height: 48, width: 1600 },
  { name: "rail", top: 52, left: 10, height: 36, width: 1200 },
  { name: "artifacts", top: 94, left: 10, height: 36, width: 500 },
  // The inspector column is portrait and nearly as tall as the whole hero, so
  // it ships as two halves that lay out side by side — one 738 px-tall image
  // next to three lines of copy is mostly whitespace.
  // The seam is the gap above the CAPS heading, so neither half ends mid-row.
  { name: "inspector-sizes", top: 92, left: 1204, height: 322, width: 406 },
  { name: "inspector-memory", top: 424, left: 1204, height: 406, width: 406 },
  { name: "dock", top: 852, left: 10, height: 56, width: 1600 },
];

mkdirSync(outDir, { recursive: true });

for (const theme of ["", "-dark"]) {
  const src = join(assets, `shellint-header${theme}.png`);
  for (const f of FIGURES) {
    const out = join(outDir, `${f.name}${theme}.png`);
    execFileSync("sips", [
      "-c",
      String(f.height),
      String(f.width),
      "--cropOffset",
      String(f.top),
      String(f.left),
      src,
      "--out",
      out,
    ]);
    console.log(`${f.name}${theme}.png  ${f.width}x${f.height}`);
  }
}
