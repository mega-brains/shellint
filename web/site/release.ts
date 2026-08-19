/*
 * The presentation site (landing + download pages) needs to link at GitHub
 * without knowing the repo slug at authoring time — the repo is not public
 * yet (M26 plan §2.3). `build-static.mjs` injects the real slug via esbuild's
 * `define` as `__SHELLINT_REPO__` (from `SHELLINT_REPO`, so CI can set
 * it once the repo exists); the `typeof` guard below is what keeps `tsc` and
 * an unbundled dev load from crashing on the undefined global.
 */
declare const __SHELLINT_REPO__: string;

export const REPO: string =
  typeof __SHELLINT_REPO__ !== "undefined" ? __SHELLINT_REPO__ : "OWNER/shellint";

/** The repo's GitHub landing page. */
export function repoUrl(): string {
  return `https://github.com/${REPO}`;
}

/** A named asset on the latest tagged release — 404s until a release exists. */
export function releaseAssetUrl(asset: string): string {
  return `https://github.com/${REPO}/releases/latest/download/${asset}`;
}

/** The releases index itself (all tags, not just latest). */
export function releasesUrl(): string {
  return `https://github.com/${REPO}/releases`;
}
