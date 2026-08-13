import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DIST_DIR } from "../core/paths.ts";

export type ArtifactInfo = { name: string; bytes: number; mtime: string };

/**
 * The only names the browser may ask for, in build-tier order. `*.adv.js` is
 * emitted only by the advanced-minify tier, so it can be missing.
 */
const ARTIFACTS = [
  "debug.raw.js",
  "debug.js",
  "debug.adv.js",
  "prod.raw.js",
  "prod.js",
  "prod.adv.js",
] as const;

type ArtifactName = (typeof ARTIFACTS)[number];

function isArtifactName(name: string): name is ArtifactName {
  return (ARTIFACTS as readonly string[]).includes(name);
}

/** Only the artifacts that exist on disk right now. */
export function listArtifacts(): ArtifactInfo[] {
  const out: ArtifactInfo[] = [];
  for (const name of ARTIFACTS) {
    const path = join(DIST_DIR, name);
    if (!existsSync(path)) continue;
    const st = statSync(path);
    out.push({ name, bytes: st.size, mtime: st.mtime.toISOString() });
  }
  return out;
}

/** null for anything not on the allowlist, or not built yet. */
export function readArtifact(
  name: string,
): { name: string; bytes: number; code: string } | null {
  if (!isArtifactName(name)) return null;
  const path = join(DIST_DIR, name);
  if (!existsSync(path)) return null;
  const code = readFileSync(path, "utf8");
  return { name, bytes: Buffer.byteLength(code, "utf8"), code };
}
