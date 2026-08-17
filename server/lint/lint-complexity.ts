import ts from "typescript";
import { createSink, type Finding } from "./lint-util.ts";
import { SCRIPT_LABEL } from "../core/paths.ts";

/**
 * Tier 5 — cognitive complexity, in the sense SonarSource defines it: how hard
 * a function is to follow, not how many paths it has.
 *
 * Cyclomatic complexity is the wrong instrument for this codebase. It ignores
 * nesting and scores every nested function separately, so the callback pyramid
 * that device code is made of reads as several trivial functions. Cognitive
 * complexity charges for nesting, which is exactly the shape that costs here —
 * it is the same structure `max-anonymous-nesting` warns about, measured
 * continuously instead of at a cliff.
 *
 * Scoring, per SonarSource's specification:
 *  - `if`, ternary, `switch`, any loop and `catch` cost `1 + nesting`;
 *  - `else` and `else if` cost 1 flat, because they add no indentation;
 *  - each run of like logical operators (`a && b && c`) costs 1;
 *  - a `break`/`continue` to a label costs 1, being a jump out of the flow;
 *  - nesting rises inside all of those, and inside a nested function — which
 *    is what makes a pyramid of callbacks expensive.
 */

/** SonarSource's default. High enough that ordinary handler code clears it. */
export const MAX_COGNITIVE_COMPLEXITY = 15;

const RULE = "max-cognitive-complexity";

function isLoop(node: ts.Node): boolean {
  return (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  );
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** `else if` is an IfStatement sitting directly in another's else slot. */
function isElseIf(node: ts.IfStatement): boolean {
  return ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
}

function isLogical(node: ts.Node): node is ts.BinaryExpression {
  if (!ts.isBinaryExpression(node)) return false;
  const kind = node.operatorToken.kind;
  return (
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken
  );
}

/** Only the first operator of a run is charged: `a && b && c` costs 1, not 2. */
function startsLogicalRun(node: ts.BinaryExpression): boolean {
  const parent = node.parent;
  return (
    !isLogical(parent) ||
    parent.operatorToken.kind !== node.operatorToken.kind
  );
}

/** Cognitive complexity of one function, counting everything nested in it. */
export function cognitiveComplexity(fn: ts.FunctionLikeDeclaration): number {
  let score = 0;

  const walk = (node: ts.Node, nesting: number) => {
    let inner = nesting;

    if (ts.isIfStatement(node)) {
      if (isElseIf(node)) {
        score += 1; // the `else` half: no extra indentation, so no penalty
      } else {
        score += 1 + nesting;
      }
      inner = nesting + 1;
      if (node.elseStatement && !ts.isIfStatement(node.elseStatement)) {
        score += 1; // a plain `else`
      }
    } else if (
      ts.isConditionalExpression(node) ||
      ts.isSwitchStatement(node) ||
      ts.isCatchClause(node) ||
      isLoop(node)
    ) {
      score += 1 + nesting;
      inner = nesting + 1;
    } else if (isFunctionLike(node)) {
      inner = nesting + 1; // the function itself is free; its contents are not
    } else if (isLogical(node) && startsLogicalRun(node)) {
      score += 1;
    } else if (
      (ts.isBreakStatement(node) || ts.isContinueStatement(node)) &&
      node.label
    ) {
      score += 1; // a jump to a label, flat — the target is not indentation
    }

    ts.forEachChild(node, (child) => walk(child, inner));
  };

  if (fn.body) ts.forEachChild(fn.body, (child) => walk(child, 0));
  return score;
}

/** Reported name for a callback that has none: the call it was passed to. */
function describe(fn: ts.FunctionLikeDeclaration, sf: ts.SourceFile): string {
  if (fn.name && ts.isIdentifier(fn.name)) return `'${fn.name.text}'`;
  const parent = fn.parent;
  if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)) {
    return `the callback passed to ${parent.expression.getText(sf)}`;
  }
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return `'${parent.name.text}'`;
  }
  return "this function";
}

/**
 * Only outermost functions are reported: their score already contains every
 * callback nested inside them, so reporting the inner ones too would charge
 * the same pyramid twice.
 */
export function lintComplexity(
  sf: ts.SourceFile,
  fileName = SCRIPT_LABEL,
): Finding[] {
  const sink = createSink(sf, fileName);

  const walk = (node: ts.Node) => {
    if (isFunctionLike(node)) {
      const score = cognitiveComplexity(node);
      if (score > MAX_COGNITIVE_COMPLEXITY) {
        sink.at(
          node,
          RULE,
          "warn",
          `${describe(node, sf)} has a cognitive complexity of ${score}, over the limit of ${MAX_COGNITIVE_COMPLEXITY} — nesting is what the score charges for, so pulling the inner callbacks out to named functions is what lowers it`,
        );
      }
      return; // do not descend: nested functions are already counted above
    }
    ts.forEachChild(node, walk);
  };

  ts.forEachChild(sf, walk);
  return sink.findings;
}
