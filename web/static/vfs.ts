/**
 * In-memory filesystem backing the static/offline compliance check (M17.4):
 * a path-keyed string store with a per-write mtime — `check.ts`'s
 * `artifacts-stale` rule (server/lint/check.ts:60-65) compares
 * scripts/main.ts's mtime against dist/*.raw.js's, so a write-time (not
 * read-time) timestamp per entry is load-bearing, not cosmetic.
 *
 * One module-level instance: `web/static/node-shims/fs.ts` is the only
 * reader (so every `existsSync`/`readFileSync`/… inside the bundled
 * server/lint/* graph resolves here instead of hitting a real disk), and
 * `pipeline.worker.ts`'s `check` handler is the only writer, seeding it fresh
 * per request from the postMessage payload.
 *
 * Paths are absolute POSIX strings rooted at REPO_ROOT — see
 * `web/static/node-shims/url.ts` and `scripts/static-esbuild.mjs`'s
 * `import.meta.url` define for why `server/core/paths.ts`'s `ROOT` resolves
 * to exactly this string inside the bundle.
 */

export const REPO_ROOT = "/repo";

type Entry = { content: string; mtimeMs: number };

const store = new Map<string, Entry>();

function norm(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

function enoent(path: string): Error & { code: string } {
  const err = new Error(`ENOENT: no such file or directory '${path}'`) as Error & {
    code: string;
  };
  err.code = "ENOENT";
  return err;
}

/** Test-only / per-request reset — the worker seeds a fresh check from scratch each time. */
export function vfsReset(): void {
  store.clear();
}

/** `mtimeMs` defaults to "now"; a caller replaying fixed history (tests) can pin it. */
export function vfsWrite(path: string, content: string, mtimeMs = Date.now()): void {
  store.set(norm(path), { content, mtimeMs });
}

export function vfsRead(path: string): string {
  const entry = store.get(norm(path));
  if (!entry) throw enoent(path);
  return entry.content;
}

/** True for an exact file match, or a directory prefix implied by some file under it. */
export function vfsExists(path: string): boolean {
  const p = norm(path);
  if (store.has(p)) return true;
  const prefix = `${p}/`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

export function vfsStat(path: string): { mtimeMs: number } {
  const entry = store.get(norm(path));
  if (!entry) throw enoent(path);
  return { mtimeMs: entry.mtimeMs };
}

/** Immediate children only (basenames), matching `fs.readdirSync(dir)`'s default
 * shape. Both callers in this bundle (lint-advisories.ts's `typeDeclarationFiles`,
 * probe-store.ts's `listCaptures`) already `existsSync`-guard the directory
 * first, so throwing on a missing one mirrors real fs rather than papering over it. */
export function vfsReaddir(path: string): string[] {
  const prefix = `${norm(path)}/`;
  const names = new Set<string>();
  for (const key of store.keys()) {
    if (!key.startsWith(prefix)) continue;
    names.add(key.slice(prefix.length).split("/")[0]!);
  }
  if (!names.size) throw enoent(path);
  return [...names];
}

/** No-op: the VFS has no real directory entries, only path prefixes implied
 * by the files written into it — nothing to create. */
export function vfsMkdir(): void {}

export function vfsDelete(path: string): void {
  store.delete(norm(path));
}

export function vfsRename(from: string, to: string): void {
  const entry = store.get(norm(from));
  if (!entry) throw enoent(from);
  store.delete(norm(from));
  store.set(norm(to), entry);
}
