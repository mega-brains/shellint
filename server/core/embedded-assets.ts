/**
 * Browser assets compiled *into* the txiki single-file executable.
 *
 * The server normally reads `web/dist` off disk relative to `process.cwd()`
 * (see paths.ts `ROOT`). That is right for a checkout and wrong for the
 * released binary, which a user runs from wherever they downloaded it: before
 * this module existed, `shellint-macos-arm64` served every `/api/*` route but
 * answered `/` with `web/index.html missing` (500) unless it happened to be
 * started from inside a clone.
 *
 * **This file is the Node/dev half and is deliberately empty.** With no entries
 * every lookup misses and static-assets.ts takes its normal filesystem path, so
 * `mise run start`, the e2e suite and the static build are untouched. The txiki
 * bundle swaps this module for a generated one (scripts/build-txiki.mjs) whose
 * map is populated — see that file for why the swap is an esbuild alias rather
 * than a package.json condition.
 *
 * Only the four assets a browser needs to boot the UI are embedded, and the
 * three large ones are embedded **brotli-compressed** (195 KB together, against
 * 715 KB raw). That is not a preference: the release asserts every binary stays
 * under 5 MB and the macOS build already sits at 4,506,842 B, leaving 736 KB —
 * the raw assets would clear that by 21 KB before esbuild's own encoding
 * overhead, and would breach it after.
 */

/** One response body, already encoded as `encoding` says. */
export type EmbeddedAsset = {
  readonly bytes: Uint8Array;
  /** `Content-Encoding` to advertise; `null` when `bytes` are identity. */
  readonly encoding: "br" | null;
  readonly type: string;
};

/**
 * Keyed by request path (`"/"`, `"/app.js"`, …). Empty here; the txiki build
 * generates the populated replacement.
 */
export const EMBEDDED_ASSETS: Record<string, EmbeddedAsset> = {};

/** The embedded asset for `path`, or `undefined` when running from a checkout. */
export function embeddedAsset(path: string): EmbeddedAsset | undefined {
  return Object.prototype.hasOwnProperty.call(EMBEDDED_ASSETS, path)
    ? EMBEDDED_ASSETS[path]
    : undefined;
}

/**
 * Small text files the executable writes beside itself on first run, keyed by
 * path relative to `ROOT`. Empty in the Node build, exactly like the map above.
 *
 * These cannot be served like the assets: nothing fetches them over HTTP, they
 * are *read off disk* by code that has to keep working in a checkout too —
 * `ensure-main-script.ts` reads `templates/main.example.ts`, and the device
 * builder reads `types/*.d.ts` (they are the whole stdlib for device code,
 * since the device compile runs `noLib` with `types: []`). Materialising is
 * also the friendlier half of the deal: the declarations land where the user
 * can read and extend them rather than staying sealed in the binary.
 */
export const EMBEDDED_FILES: Record<string, string> = {};

/**
 * Write every embedded file that is not already on disk. Never overwrites: a
 * user who edited their `types/shelly.d.ts` keeps their edit across upgrades.
 * A no-op in the Node build, where the map is empty.
 */
export async function materialiseEmbeddedFiles(
  root: string,
  fs: {
    exists(path: string): Promise<boolean>;
    mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
    atomicWriteText(path: string, text: string): Promise<unknown>;
  },
  path: { join(...parts: string[]): string; dirname(p: string): string },
): Promise<void> {
  for (const [relative, contents] of Object.entries(EMBEDDED_FILES)) {
    const target = path.join(root, relative);
    if (await fs.exists(target)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.atomicWriteText(target, contents);
  }
}
