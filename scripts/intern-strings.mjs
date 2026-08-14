/**
 * String-interning minify pass. Strings are RAM on device, and repeated RPC
 * method names (`"Switch.Set"`, `"Shelly.GetStatus"`, ...) are the common
 * case Terser never collapses on its own — each repeat costs the whole
 * literal instead of one short identifier. This hoists a repeated literal
 * into a top-level `var` and replaces every eligible occurrence with a
 * reference, but only when the net byte cost (declaration - all the
 * replacements it enables) is actually negative.
 *
 * Runs on emitted ES5 text by AST-located range splicing, same technique as
 * scripts/log-shorten.mjs: everything outside a replaced (or inserted) span
 * is preserved byte-for-byte. Placed in the pipeline after log-shorten and
 * before the Terser minify pass, so already-short log ids (`"L1"`) fall
 * below break-even naturally and are left alone.
 *
 * Never touches (same exclusions log-shorten applies to `#m`, for the same
 * reason — server/device/debug-log.ts parses metric lines from device log text):
 *   - object-literal / method / accessor property keys
 *   - element access via string (`obj["key"]`) — that string is a key, not data
 *   - a leading directive prologue (`"use strict";`)
 *   - import/export module specifiers (shouldn't exist in ES5 output)
 *   - any string literal inside a `#m <series> <value>` print/console call
 */
import ts from "typescript";

/** Log call shapes — mirrors log-shorten.mjs's LOG_CALLEES for #m detection. */
const LOG_CALLEES = new Set([
  "print",
  "console.log",
  "console.error",
  "console.warn",
]);

/** `#m <series> <value>` metric lines are parsed by server/device/debug-log.ts. */
const METRIC_PREFIX = "#m";

// Buffer.byteLength is a Node global; this module is on the browser path
// (shared/device-pipeline.mjs -> intern-strings.mjs), so use the Web API
// that both Node and a browser Worker provide instead.
function byteLen(s) {
  return new TextEncoder().encode(s).length;
}

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

/** Static string prefix from the left of a `+` chain (consecutive literals). */
function staticLeftPrefix(operands) {
  let out = "";
  for (const op of operands) {
    if (!ts.isStringLiteral(op)) break;
    out += op.text;
  }
  return out;
}

/** Whole-literal or `+`-chain metric argument — same test log-shorten uses. */
function isMetricArg(arg) {
  if (ts.isStringLiteral(arg)) return arg.text.startsWith(METRIC_PREFIX);
  if (
    ts.isBinaryExpression(arg) &&
    arg.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return staticLeftPrefix(plusOperands(arg)).startsWith(METRIC_PREFIX);
  }
  return false;
}

/** Property-key / element-access / module-specifier positions — never data. */
function isKeyPosition(node) {
  const p = node.parent;
  if (!p) return false;
  if (
    (ts.isPropertyAssignment(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p)) &&
    p.name === node
  ) {
    return true;
  }
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) {
    return true;
  }
  if (
    (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) &&
    "moduleSpecifier" in p &&
    p.moduleSpecifier === node
  ) {
    return true;
  }
  return false;
}

/** Directive-prologue string-literal-expression-statements, by start offset. */
function collectDirectiveStarts(sf) {
  const starts = new Set();
  const markPrologue = (statements) => {
    for (const stmt of statements) {
      if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) {
        starts.add(stmt.expression.getStart(sf));
      } else {
        break;
      }
    }
  };
  markPrologue(sf.statements);
  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
      node.body
    ) {
      markPrologue(node.body.statements);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return starts;
}

/**
 * First position it is safe to insert new top-level `var`s: after any
 * leading comment block (the build preserves `/* @meta *\/`-matching
 * comments through envPass's Terser run) and after any directive prologue.
 */
function computeInsertPos(sf, code, directiveStarts) {
  const commentRanges = ts.getLeadingCommentRanges(code, 0) ?? [];
  let pos = commentRanges.reduce((m, r) => Math.max(m, r.end), 0);
  for (const stmt of sf.statements) {
    if (
      ts.isExpressionStatement(stmt) &&
      ts.isStringLiteral(stmt.expression) &&
      directiveStarts.has(stmt.expression.getStart(sf))
    ) {
      pos = Math.max(pos, stmt.getEnd());
    } else {
      break;
    }
  }
  return pos;
}

/**
 * @param {string} code emitted JS (after log-shorten, before minifyPass)
 * @returns {{code: string, interned: number, savedBytes: number}}
 */
export function internStrings(code) {
  const sf = ts.createSourceFile(
    "artifact.raw.js",
    code,
    ts.ScriptTarget.ES5,
    true,
    ts.ScriptKind.JS,
  );

  const taken = new Set();
  /** @type {Array<{start: number, end: number}>} */
  const metricRanges = [];
  /** @type {import("typescript").StringLiteral[]} */
  const allStrings = [];

  const visit = (node) => {
    if (ts.isIdentifier(node)) taken.add(node.text);
    if (ts.isStringLiteral(node)) allStrings.push(node);
    if (
      ts.isCallExpression(node) &&
      LOG_CALLEES.has(calleeName(node.expression) ?? "")
    ) {
      for (const arg of node.arguments) {
        if (isMetricArg(arg)) {
          metricRanges.push({ start: arg.getStart(sf), end: arg.getEnd() });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const directiveStarts = collectDirectiveStarts(sf);
  const inMetric = (pos) =>
    metricRanges.some((r) => pos >= r.start && pos < r.end);

  /** original text -> occurrences, in first-appearance order */
  const groups = new Map();
  for (const lit of allStrings) {
    if (isKeyPosition(lit)) continue;
    const start = lit.getStart(sf);
    if (directiveStarts.has(start)) continue;
    if (inMetric(start)) continue;
    const end = lit.getEnd();
    const list = groups.get(lit.text) ?? [];
    list.push({ start, end });
    groups.set(lit.text, list);
  }

  let counter = 0;
  const freeName = () => {
    let name;
    do {
      counter += 1;
      name = `V${counter}`;
    } while (taken.has(name));
    taken.add(name);
    return name;
  };

  /** @type {Array<{name: string, text: string}>} */
  const committed = [];
  /** @type {Array<{start: number, end: number, replacement: string}>} */
  const edits = [];
  let savedBytes = 0;

  for (const [text, occurrences] of groups) {
    if (occurrences.length < 2) continue;
    const originalTotal = occurrences.reduce(
      (sum, o) => sum + byteLen(code.slice(o.start, o.end)),
      0,
    );
    const name = freeName();
    const declText = `var ${name}=${JSON.stringify(text)};`;
    const net =
      originalTotal - byteLen(declText) - byteLen(name) * occurrences.length;
    if (net <= 0) continue;

    committed.push({ name, text });
    savedBytes += net;
    for (const o of occurrences) {
      edits.push({ start: o.start, end: o.end, replacement: name });
    }
  }

  if (!committed.length) {
    return { code, interned: 0, savedBytes: 0 };
  }

  const insertPos = computeInsertPos(sf, code, directiveStarts);
  // Leading newline when inserting after existing content (prologue/@meta)
  // so the declarations don't run on into whatever precedes them; pure
  // cosmetics for the readable *.raw.js artifact, irrelevant post-Terser.
  const sep = insertPos > 0 && code[insertPos - 1] !== "\n" ? "\n" : "";
  const declBlock =
    sep +
    committed.map((g) => `var ${g.name}=${JSON.stringify(g.text)};`).join("\n") +
    "\n";
  // Zero-length insertion edit, pushed before the replacement edits so a
  // stable sort keeps it first among any edits that start at the same
  // position (e.g. the very first statement's literal is itself interned).
  const allEdits = [
    { start: insertPos, end: insertPos, replacement: declBlock },
    ...edits,
  ];
  allEdits.sort((a, b) => a.start - b.start);

  let out = "";
  let cursor = 0;
  for (const edit of allEdits) {
    if (edit.start < cursor) continue;
    out += code.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  out += code.slice(cursor);

  return { code: out, interned: committed.length, savedBytes };
}
