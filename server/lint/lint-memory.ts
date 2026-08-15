import ts from "typescript";
import { createSink, type Finding, type Sink } from "./lint-util.ts";

/**
 * Tier 5 — the two allocation shapes that cost the most on an ESP32 heap and
 * that no counter catches, because neither shows up as a byte in the artifact.
 *
 * Both are warns: they are about how much RAM the script churns, not about
 * whether it runs.
 */

/** `s += x` / `s = s + x` / `x = x.concat(y)` inside a loop: O(n²) allocation. */
const CONCAT_RULE = "no-concat-in-loop";
/** A nested callback that captures nothing is a function object per call. */
const HOIST_RULE = "prefer-hoisted-callback";

function isLoop(node: ts.Node): boolean {
  return (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  );
}

/** Leftmost operand of a `+` chain: `s + a + b` → `s`. */
function leftmost(expr: ts.Expression): ts.Expression {
  let node = expr;
  while (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    node = node.left;
  }
  return node;
}

/**
 * Names whose declaration initialises them to a string literal. Espruino has no
 * type checker here, so this plus a string-literal right-hand side is how a
 * string `+=` is told apart from a numeric counter.
 */
function stringVars(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

function isStringy(expr: ts.Expression, strings: Set<string>): boolean {
  return (
    ts.isStringLiteralLike(expr) ||
    ts.isTemplateExpression(expr) ||
    (ts.isIdentifier(expr) && strings.has(expr.text))
  );
}

/** `x = x.concat(…)` — the array cousin, and just as quadratic. */
function selfConcat(node: ts.BinaryExpression): boolean {
  if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  if (!ts.isIdentifier(node.left)) return false;
  const call = node.right;
  return (
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "concat" &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === node.left.text
  );
}

function checkConcat(
  node: ts.BinaryExpression,
  sink: Sink,
  strings: Set<string>,
) {
  if (!ts.isIdentifier(node.left)) return;
  const name = node.left.text;

  if (selfConcat(node)) {
    sink.at(
      node,
      CONCAT_RULE,
      "warn",
      `${name} = ${name}.concat(…) in a loop reallocates the whole thing every pass — push onto it, or build the parts and join once`,
    );
    return;
  }

  const grows =
    node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken
      ? node.right
      : node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isBinaryExpression(node.right) &&
          node.right.operatorToken.kind === ts.SyntaxKind.PlusToken &&
          ts.isIdentifier(leftmost(node.right)) &&
          (leftmost(node.right) as ts.Identifier).text === name
        ? node.right.right
        : null;
  if (!grows) return;
  if (!isStringy(node.left, strings) && !isStringy(grows, strings)) return;

  sink.at(
    node,
    CONCAT_RULE,
    "warn",
    `${name} grows by concatenation inside a loop — every pass allocates a new string, so the cost is quadratic in device RAM; collect the parts in an array and join once`,
  );
}

function isAnonFunction(
  node: ts.Node,
): node is ts.FunctionExpression | ts.ArrowFunction {
  return (
    (ts.isFunctionExpression(node) && !node.name) || ts.isArrowFunction(node)
  );
}

/** Parameters and locals of one function — what a nested callback could capture. */
function scopeNames(fn: ts.FunctionLikeDeclaration): Set<string> {
  const names = new Set<string>();
  for (const p of fn.parameters) {
    if (ts.isIdentifier(p.name)) names.add(p.name.text);
  }
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      names.add(node.name.text);
    }
    if (ts.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  return names;
}

/** Identifiers read as values — not member names, not declaration names. */
function freeReads(fn: ts.FunctionExpression | ts.ArrowFunction): Set<string> {
  const reads = new Set<string>();
  let usesThis = false;
  const visit = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.ThisKeyword) usesThis = true;
    if (ts.isIdentifier(node) && node.text === "arguments") usesThis = true;
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression); // skip `.name`
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      visit(node.initializer); // skip the key
      return;
    }
    if (ts.isIdentifier(node)) reads.add(node.text);
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  if (usesThis) reads.add("this");
  return reads;
}

/**
 * A callback nested inside another function, referencing nothing that function
 * (or any function between them) binds, is re-allocated on every call for no
 * reason. Hoisting it to a top-level named function costs one JsVar once.
 * `this`/`arguments` disqualify it — hoisting would change what they mean.
 */
function checkHoistable(
  fn: ts.FunctionExpression | ts.ArrowFunction,
  enclosing: Set<string>[],
  sink: Sink,
) {
  if (!enclosing.length || !fn.body) return;
  const reads = freeReads(fn);
  if (reads.has("this")) return;
  const own = scopeNames(fn);
  for (const scope of enclosing) {
    for (const name of scope) {
      if (reads.has(name) && !own.has(name)) return;
    }
  }
  sink.at(
    fn,
    HOIST_RULE,
    "warn",
    "this callback captures nothing from the function around it — a fresh function object is allocated on every call; hoist it to a top-level named function",
  );
}

export function lintMemory(
  sf: ts.SourceFile,
  fileName = "scripts/main.ts",
): Finding[] {
  const sink = createSink(sf, fileName);
  const strings = stringVars(sf);
  const enclosing: Set<string>[] = [];
  let loopDepth = 0;

  const visit = (node: ts.Node) => {
    if (loopDepth > 0 && ts.isBinaryExpression(node)) {
      checkConcat(node, sink, strings);
    }
    if (isAnonFunction(node)) checkHoistable(node, enclosing, sink);

    const enteredLoop = isLoop(node);
    if (enteredLoop) loopDepth += 1;
    const fnScope =
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
        ? scopeNames(node)
        : null;
    if (fnScope) enclosing.push(fnScope);

    ts.forEachChild(node, visit);

    if (fnScope) enclosing.pop();
    if (enteredLoop) loopDepth -= 1;
  };

  ts.forEachChild(sf, visit);
  return sink.findings;
}
