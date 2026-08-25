import ts from "typescript";
import { calleeName, objectNumberProp, type FindingFix } from "./lint-util.ts";

/**
 * The two autofixes Tier 3 owns (catalog 3.1 and 3.4). Both are whole-statement
 * rewrites rather than token edits, because both change the shape of the code
 * around the finding, not just the finding itself.
 *
 * Every precondition below is one-sided on purpose: an over-strict guard costs
 * a fix that could have been offered, an under-strict one silently rewrites
 * working code. `previewCheckFixes` shows a diff before anything is written,
 * but the diff is only worth trusting if the fix cannot be wrong.
 */

/** Leading whitespace of the line `pos` sits on, up to `pos`. */
function lineIndent(sf: ts.SourceFile, pos: number): string {
  const text = sf.text;
  let start = pos;
  while (start > 0 && text[start - 1] !== "\n") start -= 1;
  let end = start;
  while (end < pos && (text[end] === " " || text[end] === "\t")) end += 1;
  return text.slice(start, end);
}

const LEADING_WS = /^[ \t]*/;

/**
 * The statements between a block's braces, dedented to their own common indent
 * and re-indented to `indent`. Every returned line carries `indent`, the first
 * included — callers splice this in after a newline.
 */
function blockBody(sf: ts.SourceFile, block: ts.Block, indent: string): string {
  const inner = sf.text.slice(block.getStart(sf) + 1, block.getEnd() - 1);
  const lines = inner.split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return "";
  const widths = lines
    .filter((line) => line.trim())
    .map((line) => (LEADING_WS.exec(line) ?? [""])[0].length);
  const common = Math.min(...widths);
  return lines
    .map((line) => (line.trim() ? indent + line.slice(common) : ""))
    .join("\n");
}

function isFunctionScope(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function collectBindingName(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBindingName(element.name, into);
  }
}

/**
 * Names one function scope binds directly: its parameters, its own name, and
 * every `var`/`let`/`const`/`function`/`catch` declaration in its body that is
 * not inside a *nested* function. Subtrees equal to `skip` are ignored.
 */
function scopeBindings(
  fn: ts.FunctionLikeDeclaration,
  skip: ts.Node | null,
): Set<string> {
  const names = new Set<string>();
  for (const p of fn.parameters) collectBindingName(p.name, names);
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) {
    names.add(fn.name.text);
  }
  const visit = (node: ts.Node) => {
    if (node === skip || isFunctionScope(node)) return;
    if (ts.isVariableDeclaration(node)) collectBindingName(node.name, names);
    if (ts.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
    if (ts.isClassDeclaration(node) && node.name) names.add(node.name.text);
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      collectBindingName(node.variableDeclaration.name, names);
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body) ts.forEachChild(fn.body, visit);
  return names;
}

/** `{ x }` reads x; a `name`/`propertyName`/`label` slot names something else. */
function isRead(node: ts.Identifier): boolean {
  const parent = node.parent as
    | (ts.Node & { name?: ts.Node; propertyName?: ts.Node; label?: ts.Node })
    | undefined;
  if (!parent) return false;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  return (
    parent.name !== node && parent.propertyName !== node && parent.label !== node
  );
}

function readsIn(root: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node) && isRead(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return names;
}

function usesThisOrArguments(root: ts.Node): boolean {
  let hit = false;
  const visit = (node: ts.Node) => {
    if (hit) return;
    if (
      node.kind === ts.SyntaxKind.ThisKeyword ||
      node.kind === ts.SyntaxKind.SuperKeyword ||
      (ts.isIdentifier(node) && node.text === "arguments")
    ) {
      hit = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return hit;
}

// ---------------------------------------------------------------------------
// 3.4 — prefer-sync-component-access
// ---------------------------------------------------------------------------

/**
 * The params argument, reduced to the component id the sync accessor takes.
 * Absent, `null` and `{}` mean "no id"; `{ id: <literal> }` means that id.
 * Anything else carries state the accessor has nowhere to put, so no fix.
 */
function componentId(arg: ts.Expression | undefined): number | null | "reject" {
  if (!arg || arg.kind === ts.SyntaxKind.NullKeyword) return null;
  if (!ts.isObjectLiteralExpression(arg)) return "reject";
  if (arg.properties.length === 0) return null;
  if (arg.properties.length > 1) return "reject";
  const id = objectNumberProp(arg, "id");
  return id == null ? "reject" : id;
}

/** True when `name` is declared anywhere in the file outside `within`. */
function isNameTaken(sf: ts.SourceFile, name: string, within: ts.Node): boolean {
  let taken = false;
  const visit = (node: ts.Node) => {
    if (taken || node === within) return;
    const named = node as ts.Node & { name?: ts.Node };
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isClassDeclaration(node)) &&
      named.name &&
      ts.isIdentifier(named.name) &&
      named.name.text === name
    ) {
      taken = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return taken;
}

type BlockCallback = (ts.FunctionExpression | ts.ArrowFunction) & { body: ts.Block };

/** The callback forms whose body can be lifted into the enclosing scope verbatim. */
function spliceableCallback(arg: ts.Expression): BlockCallback | undefined {
  if (!ts.isFunctionExpression(arg) && !ts.isArrowFunction(arg)) return undefined;
  if (arg.modifiers?.length) return undefined;
  if (ts.isFunctionExpression(arg) && arg.asteriskToken) return undefined;
  if (!ts.isBlock(arg.body)) return undefined;
  if (usesThisOrArguments(arg.body) || hasReturn(arg.body)) return undefined;
  // `function (res, code, msg)` is the error-handling arity. The sync accessor
  // signals failure by returning `null` and carries no code or message, so a
  // body that reads either has no mechanical rewrite. Declared-and-ignored is
  // a different thing — those parameters are noise and can simply go.
  const reads = readsIn(arg.body);
  if (arg.parameters.slice(1).some((p) => !isIgnoredParameter(p, reads))) {
    return undefined;
  }
  return arg as BlockCallback;
}

function isIgnoredParameter(p: ts.ParameterDeclaration, reads: Set<string>): boolean {
  return ts.isIdentifier(p.name) && !reads.has(p.name.text);
}

/**
 * The `var` name the accessor's return value gets, `null` when the callback
 * ignores it, `"reject"` when the parameter cannot become a plain binding.
 */
function resultBinding(
  sf: ts.SourceFile,
  cb: BlockCallback,
): string | null | "reject" {
  const param = cb.parameters[0];
  if (!param) return null;
  if (!ts.isIdentifier(param.name) || param.dotDotDotToken || param.initializer) {
    return "reject";
  }
  const name = param.name.text;
  if (isNameTaken(sf, name, cb)) return "reject";
  return readsIn(cb.body).has(name) ? name : null;
}

/**
 * `Shelly.call("Switch.GetStatus", { id: 0 }, function (res) { … })` →
 * `var res = Shelly.getComponentStatus("switch", 0); …`.
 *
 * Only the statement form is rewritten. The callback body is spliced into the
 * enclosing scope, so it must not `return`, must not read `this`/`arguments`,
 * and its result parameter must not collide with a name declared elsewhere.
 * The error-handling arity (`function (res, err)`) is left alone: the sync
 * accessor signals failure by returning `null`, which is not a mechanical
 * rewrite of an error branch.
 */
export function syncComponentAccessFix(
  node: ts.CallExpression,
  component: string,
  accessor: string,
): FindingFix | undefined {
  const sf = node.getSourceFile();
  const stmt = node.parent;
  if (!ts.isExpressionStatement(stmt) || stmt.expression !== node) return undefined;
  if (node.arguments.length !== 3) return undefined;

  const id = componentId(node.arguments[1]);
  if (id === "reject") return undefined;

  const cb = spliceableCallback(node.arguments[2]);
  if (!cb) return undefined;
  const result = resultBinding(sf, cb);
  if (result === "reject") return undefined;

  const call = `Shelly.${accessor}("${component.toLowerCase()}"${id == null ? "" : `, ${id}`})`;
  const indent = lineIndent(sf, stmt.getStart(sf));
  const body = blockBody(sf, cb.body, indent);
  const head = result ? `var ${result} = ${call};` : `${call};`;
  return {
    title: `Use Shelly.${accessor}() instead of the ${component}.${accessor === "getComponentStatus" ? "GetStatus" : "GetConfig"} call`,
    start: stmt.getStart(sf),
    end: stmt.getEnd(),
    text: body ? `${head}\n${body}` : head,
  };
}

/** A `return` outside any nested function — splicing the body would swallow it. */
function hasReturn(root: ts.Node): boolean {
  let hit = false;
  const visit = (node: ts.Node) => {
    if (hit || isFunctionScope(node)) return;
    if (ts.isReturnStatement(node)) {
      hit = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return hit;
}

// ---------------------------------------------------------------------------
// 3.1 — max-anonymous-nesting
// ---------------------------------------------------------------------------

function capitalize(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/** A name derived from the call the callback is passed to, unique in the file. */
function hoistName(sf: ts.SourceFile, fn: ts.Node): string | undefined {
  let base = "hoistedCallback";
  const call = fn.parent;
  if (ts.isCallExpression(call)) {
    const callee = calleeName(call.expression);
    if (callee) base = "on" + callee.split(".").map(capitalize).join("");
  }
  for (let i = 1; i < 50; i += 1) {
    const name = i === 1 ? base : base + i;
    if (!sf.text.includes(name)) return name;
  }
  return undefined;
}

/** The statement whose parent is the source file, i.e. the top-level one. */
function topLevelStatement(sf: ts.SourceFile, fn: ts.Node): ts.Statement | undefined {
  let node: ts.Node = fn;
  while (node.parent && node.parent !== sf) node = node.parent;
  return node.parent === sf && ts.isStatement(node) ? node : undefined;
}

/** Every name bound by a function scope strictly between `fn` and the file. */
function enclosingBindings(sf: ts.SourceFile, fn: ts.Node): Set<string> {
  const names = new Set<string>();
  for (let a: ts.Node | undefined = fn.parent; a && a !== sf; a = a.parent) {
    if (!isFunctionScope(a)) continue;
    for (const name of scopeBindings(a, fn)) names.add(name);
  }
  return names;
}

/**
 * Lifts a too-deeply nested anonymous callback out to a top-level
 * `function NAME() {}` declared just above the statement it came from, and
 * leaves `NAME` behind in its place.
 *
 * Only closure-free callbacks qualify: a hoisted function loses every binding
 * the enclosing functions held, so a single read of one of those names makes
 * the rewrite silently wrong on device. `this`, `super` and `arguments` are
 * rejected for the same reason. Reads that resolve to top-level or global
 * names (`Shelly`, `print`, a helper declared at file scope) are unaffected by
 * the move and stay allowed.
 */
export function hoistAnonymousFix(
  fn: ts.FunctionExpression | ts.ArrowFunction,
): FindingFix | undefined {
  const sf = fn.getSourceFile();
  if (fn.modifiers?.length) return undefined;
  if (ts.isFunctionExpression(fn) && fn.asteriskToken) return undefined;
  if (usesThisOrArguments(fn)) return undefined;

  const stmt = topLevelStatement(sf, fn);
  if (!stmt) return undefined;

  const enclosing = enclosingBindings(sf, fn);
  if (enclosing.size) {
    const own = scopeBindings(fn, null);
    for (const name of readsIn(fn)) {
      if (enclosing.has(name) && !own.has(name)) return undefined;
    }
  }

  const name = hoistName(sf, fn);
  if (!name) return undefined;

  const indent = lineIndent(sf, stmt.getStart(sf));
  const params = fn.parameters.map((p) => p.getText(sf)).join(", ");
  const returnType = fn.type ? `: ${fn.type.getText(sf)}` : "";
  const body = ts.isBlock(fn.body)
    ? blockBody(sf, fn.body, `${indent}  `)
    : `${indent}  return ${fn.body.getText(sf)};`;
  const decl = `function ${name}(${params})${returnType} {\n${body}\n${indent}}`;

  const start = stmt.getStart(sf);
  const original = sf.text.slice(start, stmt.getEnd());
  const rewritten =
    original.slice(0, fn.getStart(sf) - start) +
    name +
    original.slice(fn.getEnd() - start);

  return {
    title: `Hoist the nested callback to function ${name}()`,
    start,
    end: stmt.getEnd(),
    text: `${decl}\n\n${indent}${rewritten}`,
  };
}
