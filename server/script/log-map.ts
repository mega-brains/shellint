import runtime from "#shellint/runtime";
import { DIST_DIR } from "../core/paths.ts";

/** Written by the prod build next to the artifact it describes. */
export const LOG_MAP_PATH = runtime.path.join(DIST_DIR, "prod.logmap.json");

/**
 * A shortened id as it reaches the log viewer: a standalone token, since device
 * log lines wrap the payload in file/line noise (see server/device/debug-log.ts).
 */
const ID_RE = /(^|\s)(L\d+)(?=\s|$)/g;

/** `{}` when the map is absent or unreadable — a missing map is not an error. */
export async function loadLogMap(): Promise<Record<string, string>> {
  if (!(await runtime.fs.exists(LOG_MAP_PATH))) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(await runtime.fs.readText(LOG_MAP_PATH));
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
export function expandLogText(text: string, map: Record<string, string> = {}): string {
  return text.replace(ID_RE, (whole, lead: string, id: string) =>
    Object.hasOwn(map, id) ? `${lead}${map[id]}` : whole,
  );
}
