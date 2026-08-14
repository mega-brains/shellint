/**
 * `node:url` shim — only `fileURLToPath` survives tree-shaking, and only
 * because `server/core/paths.ts` calls it once at module scope to derive
 * `ROOT`. A browser has no on-disk location for `import.meta.url` to resolve
 * against, so this just returns its input unchanged: paths.ts computes
 * `dirname(fileURLToPath(import.meta.url))`, and `scripts/static-esbuild.mjs`
 * defines `import.meta.url` to a fixed anchor under `../vfs.ts`'s
 * `REPO_ROOT` at build time, so the two-hop `join(here, "..", "..")` in
 * paths.ts collapses back to exactly `REPO_ROOT`.
 */
export function fileURLToPath(url: string | URL): string {
  return String(url);
}

export default { fileURLToPath };
