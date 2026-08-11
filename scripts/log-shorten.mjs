/**
 * Prod-only log-string shortening. Strings are RAM on device, and DevRoom owns
 * both the compiler and the log viewer, so `console.log("motion detected", x)`
 * ships as `console.log("L1", x)` and the log panel re-expands `L1` from the map.
 *
 * Operates on emitted ES5 text (`prod.raw.js` shape) by AST-located range
 * splicing — everything outside a replaced literal is preserved byte-for-byte.
 */
import ts from "typescript";

/** Log call shapes — same surface server/script-stats.ts counts as logging. */
const LOG_CALLEES = new Set([
  "print",
  "console.log",
  "console.error",
  "console.warn",
]);

/** `#m <series> <value>` metric lines are parsed by server/debug-log.ts. */
const METRIC_PREFIX = "#m";

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const left = calleeName(expr.expression);
    if (!left) return null;
    return `${left}.${expr.name.text}`;
  }
  return null;
}

/**
 * @param {string} code emitted JS
 * @returns {{code: string, map: Record<string,string>}} map is id -> original text
 */
export function shortenLogStrings(code) {
  const sf = ts.createSourceFile(
    "prod.raw.js",
    code,
    ts.ScriptTarget.ES5,
    true,
    ts.ScriptKind.JS,
  );

  /** original text -> id, in first-appearance order */
  const ids = new Map();
  /** @type {Array<{start: number, end: number, id: string}>} */
  const edits = [];

  const visit = (node) => {
    if (ts.isCallExpression(node) && LOG_CALLEES.has(calleeName(node.expression) ?? "")) {
      for (const arg of node.arguments) {
        if (!ts.isStringLiteral(arg)) continue;
        if (arg.text.startsWith(METRIC_PREFIX)) continue;

        const start = arg.getStart(sf);
        const end = arg.getEnd();
        const known = ids.get(arg.text);
        const id = known ?? `L${ids.size + 1}`;
        if (id.length + 2 >= end - start) continue;

        if (!known) ids.set(arg.text, id);
        edits.push({ start, end, id });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  let out = "";
  let cursor = 0;
  for (const edit of edits) {
    out += code.slice(cursor, edit.start) + `"${edit.id}"`;
    cursor = edit.end;
  }
  out += code.slice(cursor);

  /** @type {Record<string,string>} */
  const map = {};
  for (const [text, id] of ids) map[id] = text;
  return { code: out, map };
}
