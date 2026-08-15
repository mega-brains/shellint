import ts from "typescript";
import { createSink, type Finding } from "./lint-util.ts";

/**
 * Tier 1 — `no-use-before-define`. Espruino reads a script top to bottom and,
 * per the LanguageReference, does not hoist: a name read above the declaration
 * that binds it is `undefined` there on device, while the same code runs fine
 * in Node and in the browser. That makes it the worst failure shape the
 * checker has — wrong at runtime, not a parse error.
 *
 * Scope model, deliberately small: the source file plus one scope per function.
 * `var` is function-scoped (it is); `let`/`const` are treated the same way
 * (they are not, but tsc already refuses a use-before-declare on those, and
 * widening their scope can only suppress a report, never invent one). No
 * control flow is modelled — position in the text is the whole test, and only
 * within the one scope that binds the name, which is ESLint's `functions:
 * false` behaviour. The hole that leaves is an IIFE reading a name declared
 * below it; the noise it removes is every callback that calls a helper defined
 * further down the file, which is how device scripts are written.
 */

/** What a name is bound to, and where. `kind: null` is never reported on. */
type Binding = { pos: number; kind: "var" | "function" | null };

type Scope = { parent: Scope | null; names: Map<string, Binding> };

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
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

/** Earliest declaration wins: `var x = 1; … var x = 2;` binds at the first. */
function declare(
  scope: Scope,
  name: string,
  pos: number,
  kind: Binding["kind"],
) {
  const prev = scope.names.get(name);
  if (prev && prev.pos <= pos) return;
  scope.names.set(name, { pos, kind });
}

/** Declarations belonging to one scope; nested functions are scopes of their own. */
function collect(node: ts.Node, scope: Scope, sf: ts.SourceFile) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    const list = node.parent;
    const isVar =
      ts.isVariableDeclarationList(list) &&
      (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
    declare(scope, node.name.text, node.name.getStart(sf), isVar ? "var" : null);
  }
  if (ts.isFunctionDeclaration(node) && node.name) {
    declare(scope, node.name.text, node.getStart(sf), "function");
  }
  if (ts.isClassDeclaration(node) && node.name) {
    declare(scope, node.name.text, node.getStart(sf), null);
  }
  if (isFunctionLike(node)) return;
  ts.forEachChild(node, (child) => collect(child, scope, sf));
}

/** Parameters and the function's own name are bound before any read of them. */
function functionScope(
  fn: ts.FunctionLikeDeclaration,
  parent: Scope,
  sf: ts.SourceFile,
): Scope {
  const scope: Scope = { parent, names: new Map() };
  for (const p of fn.parameters) {
    if (ts.isIdentifier(p.name)) declare(scope, p.name.text, -1, null);
  }
  if (
    (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) &&
    fn.name
  ) {
    declare(scope, fn.name.text, -1, null);
  }
  if (fn.body) ts.forEachChild(fn.body, (child) => collect(child, scope, sf));
  return scope;
}

/**
 * `{ x }` reads x; every other `name`/`propertyName`/`label` slot — a member
 * name, a declaration name, a loop label — names something that is not a
 * binding read.
 */
function isRead(node: ts.Identifier): boolean {
  const parent = node.parent as
    | (ts.Node & { name?: ts.Node; propertyName?: ts.Node; label?: ts.Node })
    | undefined;
  if (!parent) return false;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  return (
    parent.name !== node &&
    parent.propertyName !== node &&
    parent.label !== node
  );
}

export function checkUseBeforeDefine(
  sf: ts.SourceFile,
  fileName: string,
): Finding[] {
  const sink = createSink(sf, fileName);
  const top: Scope = { parent: null, names: new Map() };
  ts.forEachChild(sf, (child) => collect(child, top, sf));

  const resolve = (node: ts.Identifier, scope: Scope) => {
    for (let s: Scope | null = scope; s; s = s.parent) {
      const binding = s.names.get(node.text);
      if (!binding) continue; // an enclosing scope may still bind it
      // Only a read in the scope that binds the name is reported. Crossing a
      // function boundary means the read happens whenever that function is
      // called, which on a callback-driven device is normally long after the
      // whole script has been parsed — the `Timer.set(…, function () { tick();
      // }); function tick() {}` idiom is safe and must stay quiet.
      if (binding.kind && s === scope && binding.pos > node.getStart(sf)) {
        const line = sf.getLineAndCharacterOfPosition(binding.pos).line + 1;
        sink.at(
          node,
          "no-use-before-define",
          "warn",
          `${node.text} is read above its ${binding.kind} declaration on line ${line} — the LanguageReference says Espruino does not hoist, so this reads undefined on device; no probe has confirmed that behaviour, so a probe expression can falsify this warning`,
        );
      }
      return; // the nearest binding wins, shadowing included
    }
  };

  const walk = (node: ts.Node, scope: Scope) => {
    if (isFunctionLike(node)) {
      const inner = functionScope(node, scope, sf);
      ts.forEachChild(node, (child) => walk(child, inner));
      return;
    }
    if (
      ts.isTypeNode(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node)
    ) {
      return; // types are erased before the device ever sees them
    }
    if (ts.isIdentifier(node) && isRead(node)) resolve(node, scope);
    ts.forEachChild(node, (child) => walk(child, scope));
  };

  ts.forEachChild(sf, (child) => walk(child, top));
  return sink.findings;
}
