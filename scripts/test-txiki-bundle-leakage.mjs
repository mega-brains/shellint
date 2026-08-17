import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const bundleArg = process.argv[2];
if (!bundleArg) {
  throw new Error("usage: node scripts/test-txiki-bundle-leakage.mjs <bundle.js>");
}

const bundlePath = resolve(bundleArg);
const source = readFileSync(bundlePath, "utf8");
const file = ts.createSourceFile(bundlePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const issues = [];
const nodeBuiltins = new Set([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "process",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "worker_threads",
  "zlib",
]);

function location(node) {
  const start = file.getLineAndCharacterOfPosition(node.getStart(file));
  return `${start.line + 1}:${start.character + 1}`;
}

function add(kind, node, detail) {
  issues.push(`${location(node)} ${kind}: ${detail}`);
}

function moduleLeak(specifier) {
  if (specifier.startsWith("node:")) return "Node builtin";
  if (nodeBuiltins.has(specifier) || nodeBuiltins.has(specifier.split("/")[0])) {
    return "bare Node builtin";
  }
  if (specifier === "@hono/node-server" || specifier.startsWith("@hono/node-server/")) {
    return "Node Hono adapter";
  }
  if (specifier === "ws" || specifier.startsWith("ws/")) return "ws package";
  return null;
}

function stringValue(node) {
  return ts.isStringLiteralLike(node) ? node.text : null;
}

function unwrap(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function isTypeofProcess(node) {
  const current = unwrap(node);
  return ts.isTypeOfExpression(current) &&
    ts.isIdentifier(unwrap(current.expression)) &&
    unwrap(current.expression).text === "process";
}

function guaranteesProcess(condition) {
  const current = unwrap(condition);
  if (!ts.isBinaryExpression(current)) return false;
  if (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return guaranteesProcess(current.left) || guaranteesProcess(current.right);
  }
  const comparison = new Set([
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
  ]);
  if (!comparison.has(current.operatorToken.kind)) return false;
  const leftTypeof = isTypeofProcess(current.left);
  const rightTypeof = isTypeofProcess(current.right);
  const literal = leftTypeof ? stringValue(unwrap(current.right)) : stringValue(unwrap(current.left));
  if ((!leftTypeof && !rightTypeof) || literal == null) return false;
  const equality = current.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
    current.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
  return equality ? literal !== "undefined" : literal === "undefined";
}

function guardedByAncestor(node) {
  let child = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent) && child === parent.thenStatement) {
      if (guaranteesProcess(parent.expression)) return true;
    }
    if (ts.isConditionalExpression(parent) && child === parent.whenTrue) {
      if (guaranteesProcess(parent.condition)) return true;
    }
    if (ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      child === parent.right && guaranteesProcess(parent.left)) {
      return true;
    }
  }
  return false;
}

function checkModule(node, specifier) {
  const leak = moduleLeak(specifier);
  if (leak) add("module", node, `${leak} ${JSON.stringify(specifier)}`);
}

function visit(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    const specifier = stringValue(node.moduleSpecifier);
    if (specifier) checkModule(node.moduleSpecifier, specifier);
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const specifier = node.arguments[0] && stringValue(node.arguments[0]);
    if (specifier) checkModule(node.arguments[0], specifier);
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
    add("require", node, "bare require() call");
  }
  if (ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) && node.expression.text === "process" &&
    !guardedByAncestor(node)) {
    add("process", node, `unguarded process.${node.name.text}`);
  }
  ts.forEachChild(node, visit);
}
visit(file);

for (const marker of [
  "node_modules/@hono/node-server/",
  "node_modules/ws/",
  "WS_NO_BUFFER_UTIL",
  "WS_NO_UTF_8_VALIDATE",
]) {
  if (source.includes(marker)) issues.push(`bundle marker: ${marker}`);
}

if (issues.length > 0) {
  throw new Error(`txiki bundle leakage found:\n${issues.map((x) => `  ${x}`).join("\n")}`);
}

console.log(`txiki bundle leakage ok (${statSync(bundlePath).size} B)`);

