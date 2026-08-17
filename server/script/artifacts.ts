import runtime from "#devroom/runtime";
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
export async function listArtifacts(): Promise<ArtifactInfo[]> {
  const out: ArtifactInfo[] = [];
  for (const name of ARTIFACTS) {
    const path = runtime.path.join(DIST_DIR, name);
    if (!(await runtime.fs.exists(path))) continue;
    const st = await runtime.fs.stat(path);
    out.push({ name, bytes: st.size, mtime: new Date(st.mtimeMs).toISOString() });
  }
  return out;
}

/** null for anything not on the allowlist, or not built yet. */
export async function readArtifact(
  name: string,
): Promise<{ name: string; bytes: number; code: string } | null> {
  if (!isArtifactName(name)) return null;
  const path = runtime.path.join(DIST_DIR, name);
  if (!(await runtime.fs.exists(path))) return null;
  const code = await runtime.fs.readText(path);
  return { name, bytes: runtime.byteLength(code), code };
}
