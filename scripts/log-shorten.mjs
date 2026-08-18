/**
 * Log-string shortening. Strings are RAM on device, and shellint owns both.
 * compiler and the log viewer, so `console.log("motion detected", x)` ships as
 * `console.log("L1", x)` and the log panel re-expands `L1` from the map.
 *
 * Also shortens string-literal leaves inside `+` chains (A), folding adjacent
 * static literals first when safe (B). Leading/trailing whitespace stays in the
 * emitted literal so `L#` remains a standalone token after runtime concat.
 *
 * Operates on emitted ES5 text by AST-located range splicing — everything
 * outside a replaced span is preserved byte-for-byte.
 */
import ts from "typescript";

/** Log call shapes — same surface server/script/script-stats.ts counts as logging. */
const LOG_CALLEES = new Set([
  "print",
  "console.log",
  "console.error",
  "console.warn",
]);

/** `#m <series> <value>` metric lines are parsed by server/device/debug-log.ts. */
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

/** Flatten a left-associative `+` chain into operand leaves (non-`+` nodes). */
function plusOperands(node) {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return [...plusOperands(node.left), ...plusOperands(node.right)];
  }
  return [node];
}

/**
 * Static string prefix from the left of a `+` chain (consecutive string
 * literals only). Used to detect `#m` metric chains.
 */
function staticLeftPrefix(operands) {
  let out = "";
  for (const op of operands) {
    if (!ts.isStringLiteral(op)) break;
    out += op.text;
  }
  return out;
}

/**
 * Split edge whitespace so the id keeps padding in the emitted literal while
 * the map stores the core text.
 * @returns {{ lead: string, core: string, trail: string }}
 */
function splitPad(text) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  return { lead: m[1], core: m[2], trail: m[3] };
}

/**
 * @param {string} code emitted JS
 * @param {Map<string, string>} [sharedIds] optional shared original→id map
 *   (so debug + prod builds can mint consistent ids into one logmap file)
 * @returns {{code: string, map: Record<string,string>}} map is id -> original text
 */
export function shortenLogStrings(code, sharedIds) {
  const sf = ts.createSourceFile(
    "artifact.raw.js",
    code,
    ts.ScriptTarget.ES5,
    true,
    ts.ScriptKind.JS,
  );

  /** original core text -> id, in first-appearance order */
  const ids = sharedIds ?? new Map();
  /** @type {Array<{start: number, end: number, replacement: string}>} */
  const edits = [];

  /** Whole-arg string literal — device log wrapper already bounds the token. */
  const considerWhole = (arg) => {
    if (arg.text.startsWith(METRIC_PREFIX)) return;
    const start = arg.getStart(sf);
    const end = arg.getEnd();
    const known = ids.get(arg.text);
    const id = known ?? `L${ids.size + 1}`;
    if (id.length + 2 >= end - start) return;
    if (!known) ids.set(arg.text, id);
    edits.push({ start, end, replacement: `"${id}"` });
  };

  /**
   * One run of adjacent string literals inside a `+` chain: fold (B), then
   * shorten with edge-whitespace padding (A).
   */
  const considerRun = (run) => {
    const folded = run.map((n) => n.text).join("");
    if (folded.startsWith(METRIC_PREFIX)) return;

    const { lead, core, trail } = splitPad(folded);
    if (!core) return;
    // Concat leaves need edge whitespace so `L#` stays a standalone token after
    // runtime join. Skip glued pieces like `"x="` + v.
    if (!lead && !trail) return;
    if (core.startsWith(METRIC_PREFIX)) return;

    const start = run[0].getStart(sf);
    const end = run[run.length - 1].getEnd();
    const known = ids.get(core);
    const id = known ?? `L${ids.size + 1}`;
    const emitted = `"${lead}${id}${trail}"`;
    if (emitted.length >= end - start) return;
    if (!known) ids.set(core, id);
    edits.push({ start, end, replacement: emitted });
  };

  /** Process a `+` chain arg: #m skip, then adjacent-literal runs. */
  const considerChain = (arg) => {
    const operands = plusOperands(arg);
    if (staticLeftPrefix(operands).startsWith(METRIC_PREFIX)) return;

    /** @type {import("typescript").StringLiteral[]} */
    let run = [];
    const flush = () => {
      if (run.length) considerRun(run);
      run = [];
    };
    for (const op of operands) {
      if (ts.isStringLiteral(op)) run.push(op);
      else flush();
    }
    flush();
  };

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      LOG_CALLEES.has(calleeName(node.expression) ?? "")
    ) {
      for (const arg of node.arguments) {
        if (ts.isStringLiteral(arg)) {
          considerWhole(arg);
        } else if (
          ts.isBinaryExpression(arg) &&
          arg.operatorToken.kind === ts.SyntaxKind.PlusToken
        ) {
          considerChain(arg);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const edit of edits) {
    if (edit.start < cursor) continue;
    out += code.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  out += code.slice(cursor);

  /** @type {Record<string,string>} */
  const map = {};
  for (const [text, id] of ids) map[id] = text;
  return { code: out, map };
}
