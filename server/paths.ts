import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Repo root (parent of server/). */
export const ROOT = join(here, "..");

export const SCRIPT_PATH = join(ROOT, "scripts", "main.ts");
export const DIST_DIR = join(ROOT, "dist");
export const WEB_DIR = join(ROOT, "web");
export const PROBE_PATH = join(ROOT, "types", "generated-probe.json");
export const DEVROOM_JSON = join(ROOT, "devroom.json");
