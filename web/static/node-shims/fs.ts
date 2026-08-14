/**
 * `node:fs` shim for the static/offline check bundle (M17.4), aliased in by
 * `scripts/static-esbuild.mjs`. Named exports are exactly what bundling
 * `server/lint/check.ts`'s import graph actually pulls (found empirically —
 * bundle, read esbuild's unresolved-import errors, repeat), not a general
 * POSIX fs surface: `chmodSync`/`renameSync`/`unlinkSync` come from
 * `server/device/devices.ts` and `server/probe/probe-store.ts`, reachable
 * only because those modules are statically imported for `readDeviceProfile`
 * / `activeDeviceIdentity` — their write paths are never actually exercised
 * by a read-only `runCheck({ connected: false })`, so a faithful-but-minimal
 * implementation over the VFS is enough.
 */
import {
  vfsDelete,
  vfsExists,
  vfsMkdir,
  vfsReaddir,
  vfsRead,
  vfsRename,
  vfsStat,
  vfsWrite,
} from "../vfs.ts";

export function existsSync(path: string): boolean {
  return vfsExists(path);
}
export function readFileSync(path: string): string {
  return vfsRead(path);
}
export function writeFileSync(path: string, data: string): void {
  vfsWrite(path, data);
}
export function statSync(path: string): { mtimeMs: number } {
  return vfsStat(path);
}
export function readdirSync(path: string): string[] {
  return vfsReaddir(path);
}
export function mkdirSync(): void {
  vfsMkdir();
}
/** The VFS has no permission model — devices.ts's 0600 chmod is inert here. */
export function chmodSync(): void {}
export function renameSync(from: string, to: string): void {
  vfsRename(from, to);
}
export function unlinkSync(path: string): void {
  vfsDelete(path);
}

export default {
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
  mkdirSync,
  chmodSync,
  renameSync,
  unlinkSync,
};
