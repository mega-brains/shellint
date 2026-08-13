import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DIST_DIR } from "../core/paths.ts";

/** Written by the prod build next to the artifact it describes. */
export const LOG_MAP_PATH = join(DIST_DIR, "prod.logmap.json");

/**
 * A shortened id as it reaches the log viewer: a standalone token, since device
 * log lines wrap the payload in file/line noise (see server/device/debug-log.ts).
 */
const ID_RE = /(^|\s)(L\d+)(?=\s|$)/g;

/** `{}` when the map is absent or unreadable — a missing map is not an error. */
export function loadLogMap(): Record<string, string> {
  if (!existsSync(LOG_MAP_PATH)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(LOG_MAP_PATH, "utf8"));
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const map: Record<string, string> = {};
  for (const [id, text] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof text === "string") map[id] = text;
  }
  return map;
}

/** Restore original log text for every mapped id token; leave the rest alone. */
export function expandLogText(text: string, map = loadLogMap()): string {
  return text.replace(ID_RE, (whole, lead: string, id: string) =>
    Object.hasOwn(map, id) ? `${lead}${map[id]}` : whole,
  );
}
