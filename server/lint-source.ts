import { readFileSync, existsSync } from "node:fs";
import ts from "typescript";
import { SCRIPT_PATH } from "./paths.ts";

export type Finding = {
  severity: "error" | "warn";
  rule: string;
  message: string;
  file?: string;
  line?: number;
};

/**
 * Tier 1 rules restricted to what `tsc` cannot down-level for us.
 * Arrow functions, classes, template literals, destructuring and spread are
 * legal in the TypeScript source because the ES5 emit removes them; the
 * post-compile guard in dialect-check.ts is what catches a compiler regression.
 */
const RESERVED_RPC_NAMES = [
  "GetStatus",
  "GetConfig",
  "SetConfig",
  "Start",
  "Stop",
  "Eval",
  "PutCode",
  "GetCode",
  "Create",
  "Delete",
  "List",
];

const CAPS: Record<string, { limit: number; rule: string }> = {
  "Timer.set": { limit: 5, rule: "max-timers" },
  "Shelly.addEventHandler": { limit: 5, rule: "max-event-handlers" },
  "Shelly.addStatusHandler": { limit: 5, rule: "max-status-handlers" },
  "HTTPServer.registerEndpoint": { limit: 5, rule: "max-http-endpoints" },
  "Script.addRpcHandler": { limit: 5, rule: "max-rpc-handlers" },
  "MQTT.subscribe": { limit: 10, rule: "max-mqtt-subscriptions" },
};

const MAX_STORAGE_ITEMS = 12;
const MAX_STORAGE_KEY_BYTES = 16;
const MAX_STORAGE_VALUE_BYTES = 1024;
const MAX_RPC_NAME_CHARS = 32;

function calleeName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const left = calleeName(expr.expression);
    return left ? `${left}.${expr.name.text}` : null;
  }
  return null;
}

function stringArg(node: ts.CallExpression, index: number): string | null {
  const arg = node.arguments[index];
  if (!arg) return null;
  return ts.isStringLiteralLike(arg) ? arg.text : null;
}

type RegistrationSite = { conditional: boolean };

export function lintSource(
  source: string,
  fileName = "scripts/main.ts",
): Finding[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES5,
    true,
    ts.ScriptKind.TS,
  );
  const findings: Finding[] = [];
  const registrations = new Map<string, RegistrationSite[]>();
  const storageKeys = new Set<string>();
  let loopDepth = 0;
  let branchDepth = 0;

  const add = (
    node: ts.Node,
    rule: string,
    severity: "error" | "warn",
    message: string,
  ) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ severity, rule, message, file: fileName, line: line + 1 });
  };

  const addFileLevel = (
    rule: string,
    severity: "error" | "warn",
    message: string,
  ) => {
    findings.push({ severity, rule, message, file: fileName });
  };

  const checkTier1 = (node: ts.Node) => {
    if (ts.isRegularExpressionLiteral(node)) {
      add(node, "no-regexp", "error", "RegExp literal not supported on device");
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "RegExp"
    ) {
      add(node, "no-regexp", "error", "new RegExp() not supported on device");
    }
    if (
      ts.isIdentifier(node) &&
      node.text === "Promise" &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) {
      add(node, "no-async", "error", "Promise is not available on device");
    }
    if (ts.isAwaitExpression(node)) {
      add(node, "no-async", "error", "await not supported");
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    ) {
      add(node, "no-async", "error", "async functions not supported");
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)) &&
      node.asteriskToken
    ) {
      add(node, "no-generators", "error", "generator functions not supported");
    }
    if (ts.isYieldExpression(node)) {
      add(node, "no-generators", "error", "yield not supported");
    }
    if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      add(node, "no-accessors", "error", "get/set accessors not supported");
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(
        node,
        "no-modules",
        "error",
        "ES modules not supported — output must be one flat script",
      );
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      add(node, "no-modules", "error", "require() not supported on device");
    }
    if (ts.isLabeledStatement(node)) {
      add(node, "no-labeled-statements", "warn", "labeled statement unverified on device");
    }
    if (ts.isWithStatement(node)) {
      add(node, "no-with", "warn", "with statement unverified on device");
    }
    if (ts.isStringLiteral(node) && /\\u/.test(node.getText(sf))) {
      add(
        node,
        "no-unicode-escapes",
        "warn",
        "only \\xHH escapes are supported in device strings",
      );
    }
  };

  const checkStringRegexMethods = (node: ts.CallExpression, name: string) => {
    const method = name.split(".").pop() ?? "";
    if (method === "match" || method === "search") {
      add(
        node,
        "no-regexp",
        "error",
        `String.prototype.${method} requires RegExp, which the device lacks`,
      );
      return;
    }
    if (method !== "replace" && method !== "split") return;
    const arg = node.arguments[0];
    if (arg && ts.isRegularExpressionLiteral(arg)) {
      add(
        node,
        "no-regexp",
        "error",
        `${method}() with a RegExp argument is not supported`,
      );
    }
  };

  const checkStorage = (node: ts.CallExpression, name: string) => {
    if (!name.startsWith("Script.storage.")) return;
    const key = stringArg(node, 0);
    if (key == null) return;
    storageKeys.add(key);
    const keyBytes = Buffer.byteLength(key, "utf8");
    if (keyBytes > MAX_STORAGE_KEY_BYTES) {
      add(
        node,
        "storage-key-length",
        "error",
        `storage key "${key}" is ${keyBytes} B, device cap is ${MAX_STORAGE_KEY_BYTES} B`,
      );
    }
    if (name.endsWith(".setItem")) {
      const value = stringArg(node, 1);
      if (value != null) {
        const bytes = Buffer.byteLength(value, "utf8");
        if (bytes > MAX_STORAGE_VALUE_BYTES) {
          add(
            node,
            "storage-value-length",
            "error",
            `storage value for "${key}" is ${bytes} B, device cap is ${MAX_STORAGE_VALUE_BYTES} B`,
          );
        }
      }
    }
  };

  const checkRpcName = (node: ts.CallExpression, name: string) => {
    if (name !== "Script.addRpcHandler") return;
    const method = stringArg(node, 0);
    if (method == null) return;
    if (method.length > MAX_RPC_NAME_CHARS) {
      add(
        node,
        "rpc-method-name-length",
        "error",
        `RPC method "${method}" is ${method.length} chars, cap is ${MAX_RPC_NAME_CHARS}`,
      );
    }
    if (RESERVED_RPC_NAMES.includes(method)) {
      add(
        node,
        "no-reserved-rpc-name",
        "error",
        `RPC method "${method}" collides with a built-in Shelly method`,
      );
    }
  };

  const checkTier2Call = (node: ts.CallExpression) => {
    const name = calleeName(node.expression);
    if (!name) return;
    checkStringRegexMethods(node, name);
    checkStorage(node, name);
    checkRpcName(node, name);
    if (!CAPS[name]) return;
    const sites = registrations.get(name) ?? [];
    sites.push({ conditional: branchDepth > 0 });
    registrations.set(name, sites);
    if (loopDepth > 0) {
      add(
        node,
        "no-registration-in-loop",
        "error",
        `${name} inside a loop — registrations cannot be counted and will exhaust the device cap`,
      );
    }
  };

  const isLoop = (node: ts.Node) =>
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node);

  const isBranch = (node: ts.Node) =>
    ts.isIfStatement(node) ||
    ts.isConditionalExpression(node) ||
    ts.isSwitchStatement(node);

  const visit = (node: ts.Node) => {
    checkTier1(node);
    if (ts.isCallExpression(node)) checkTier2Call(node);

    const enteredLoop = isLoop(node);
    const enteredBranch = isBranch(node);
    if (enteredLoop) loopDepth += 1;
    if (enteredBranch) branchDepth += 1;
    ts.forEachChild(node, visit);
    if (enteredLoop) loopDepth -= 1;
    if (enteredBranch) branchDepth -= 1;
  };

  visit(sf);

  for (const [name, sites] of registrations) {
    const cap = CAPS[name]!;
    const conditional = sites.filter((s) => s.conditional).length;
    const confirmed = sites.length - conditional;
    const caveat = conditional
      ? ` (${confirmed} confirmed + ${conditional} conditional)`
      : "";
    if (confirmed > cap.limit) {
      addFileLevel(
        cap.rule,
        "error",
        `${name} called ${sites.length}×${caveat}, device cap is ${cap.limit}`,
      );
    } else if (sites.length > cap.limit) {
      addFileLevel(
        cap.rule,
        "warn",
        `${name} may exceed the cap of ${cap.limit}${caveat} — conditional registrations cannot be resolved statically`,
      );
    }
  }

  if (storageKeys.size > MAX_STORAGE_ITEMS) {
    addFileLevel(
      "max-storage-items",
      "error",
      `${storageKeys.size} distinct Script.storage keys, device cap is ${MAX_STORAGE_ITEMS}`,
    );
  }

  return findings;
}

export function lintScriptFile(path = SCRIPT_PATH): Finding[] {
  if (!existsSync(path)) {
    throw new Error(`script not found: ${path}`);
  }
  return lintSource(readFileSync(path, "utf8"), "scripts/main.ts");
}
