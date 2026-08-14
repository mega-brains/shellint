/**
 * `node:path` shim — POSIX `join`/`dirname` (the two the bundled
 * `server/lint/check.ts` graph actually calls) plus `relative`/`resolve` for
 * parity with the rest of Node's surface a later milestone (`file-io.ts`,
 * M17.6) is expected to need. The VFS's keys are already absolute
 * `/`-separated strings (see ../vfs.ts's REPO_ROOT), so no Windows-path
 * handling is needed.
 */

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return (path.startsWith("/") ? "/" : "") + out.join("/");
}

export function join(...segments: string[]): string {
  return normalize(segments.join("/"));
}

export function dirname(path: string): string {
  const norm = normalize(path);
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return norm.startsWith("/") ? "/" : ".";
  return norm.slice(0, idx);
}

export function relative(from: string, to: string): string {
  const a = normalize(from).split("/").filter(Boolean);
  const b = normalize(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/") || ".";
}

export function resolve(...segments: string[]): string {
  return normalize(segments.join("/"));
}

export default { join, dirname, relative, resolve };
