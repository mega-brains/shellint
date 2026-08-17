/** Async filesystem seam shared by txiki.js and test-memory runtimes. */
export interface RuntimeAdapter {
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  makeDir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/** `C:/…` or `c:/…` — a Windows drive-absolute path once separators are `/`. */
const DRIVE_ABSOLUTE = /^[A-Za-z]:\//;

/** True for both `/usr/x` and `C:/Users/x`. */
export function isAbsolutePath(path: string): boolean {
  const input = path.replace(/\\/g, "/");
  return input.startsWith("/") || DRIVE_ABSOLUTE.test(input);
}

/**
 * POSIX-style normalization without importing `node:path`. Output always uses
 * `/`, which Windows accepts everywhere; a `C:/…` prefix is preserved so an
 * absolute Windows path is not mistaken for a relative one by `resolvePath`.
 */
export function normalizePath(path: string): string {
  const input = path.replace(/\\/g, "/");
  const drive = DRIVE_ABSOLUTE.test(input) ? input.slice(0, 2) : "";
  const absolute = input.startsWith("/") || drive !== "";
  const parts: string[] = [];
  for (const part of input.slice(drive.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join("/");
  if (absolute) return `${drive}/${joined}`;
  return joined || ".";
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

export function resolvePath(root: string, path: string): string {
  return normalizePath(isAbsolutePath(path) ? path : joinPath(root, path));
}

