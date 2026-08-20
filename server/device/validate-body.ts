/**
 * Field checks for the untrusted JSON bodies the device routes accept. Nothing
 * here is cosmetic: these values reach `Script.PutCode` (the slot) and
 * `ws://${ip}/rpc` (the ip), so a body naming a slot that is not a slot, or an
 * ip that re-points that URL, has to be refused before the RPC opens. Lives
 * outside routes.ts only to keep that file under the 500-line cap.
 */

/** All optional — an absent field passes, since each route has its own default. */
const STRING_FIELDS = ["device", "script", "label", "createName", "ip"];

/** The first problem found, or null when the body is acceptable. */
export function bodyError(body: Record<string, unknown>): string | null {
  for (const field of STRING_FIELDS) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return `${field} must be a string`;
    }
  }
  const slot = body.slot;
  if (slot !== undefined && (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0)) {
    return "slot must be a non-negative integer";
  }
  // In `ws://${ip}/rpc` a "/" ends the authority, "?" starts a query and "@"
  // turns everything before it into userinfo — each one re-targets the socket.
  if (typeof body.ip === "string" && /[/?@]/.test(body.ip)) {
    return 'ip must not contain "/", "?" or "@"';
  }
  return null;
}
