/** Async filesystem seam shared by txiki.js and test-memory runtimes. */
export interface RuntimeAdapter {
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  makeDir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/** POSIX-style normalization without importing `node:path`. */
export function normalizePath(path: string): string {
  const input = path.replace(/\\/g, "/");
  const absolute = input.startsWith("/");
  const parts: string[] = [];
  for (const part of input.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join("/");
  if (absolute) return `/${joined}`;
  return joined || ".";
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

export function resolvePath(root: string, path: string): string {
  return normalizePath(path.startsWith("/") ? path : joinPath(root, path));
}

