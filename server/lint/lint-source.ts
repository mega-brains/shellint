import { runtime } from "#shellint/runtime";
import ts from "typescript";
import { SCRIPT_LABEL, SCRIPT_PATH } from "../core/paths.ts";
import { checkUseBeforeDefine } from "./lint-hoisting.ts";
import {
  calleeName,
  definesAccessor,
  hasUnicodeEscape,
  isFunctionLike,
  isNamedCallee,
  stringArg,
  type Finding,
  type FindingFix,
} from "./lint-util.ts";

export type { Finding };

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

type RegistrationSite = { conditional: boolean };

type Tier1Rule = {
  rule: string;
  severity: "error" | "warn";
  message: string;
  match: (node: ts.Node, sf: ts.SourceFile) => boolean;
  fix?: (node: ts.Node, sf: ts.SourceFile) => FindingFix;
};

/**
 * One entry per construct, applied in order to every node — the order is the
 * order findings come out in, which the check pane and its tests rely on.
 */
const TIER1_RULES: Tier1Rule[] = [
  {
    rule: "no-regexp",
    severity: "error",
    message: "RegExp literal not supported on device",
    match: (n) => ts.isRegularExpressionLiteral(n),
  },
  {
    rule: "no-regexp",
    severity: "error",
    message: "new RegExp() not supported on device",
    match: (n) => ts.isNewExpression(n) && isNamedCallee(n, "RegExp"),
  },
  {
    rule: "no-regexp",
    severity: "error",
    message: "RegExp() not supported on device",
    match: (n) => ts.isCallExpression(n) && isNamedCallee(n, "RegExp"),
  },
  {
    rule: "no-async",
    severity: "error",
    message: "Promise is not available on device",
    match: (n) =>
      ts.isIdentifier(n) &&
      n.text === "Promise" &&
      !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n),
  },
  {
    rule: "no-async",
    severity: "error",
    message: "await not supported",
    match: (n) => ts.isAwaitExpression(n),
  },
  {
    // A device object defining its own `then` is conceivable, so this is the
    // repo's unverified-⇒-warn case rather than an error.
    rule: "no-async",
    severity: "warn",
    message:
      ".then() is a Promise idiom and the device has no Promise — device APIs take a callback argument",
    match: (n) =>
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "then",
  },
  {
    rule: "no-async",
    severity: "error",
    message: "async functions not supported",
    match: (n) =>
      (isFunctionLike(n) || ts.isArrowFunction(n)) &&
      ts.canHaveModifiers(n) &&
      !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
  },
  {
    rule: "no-generators",
    severity: "error",
    message: "generator functions not supported",
    match: (n) => isFunctionLike(n) && !!n.asteriskToken,
  },
  {
    rule: "no-generators",
    severity: "error",
    message: "yield not supported",
    match: (n) => ts.isYieldExpression(n),
  },
  {
    rule: "no-accessors",
    severity: "error",
    message: "get/set accessors not supported",
    match: (n) =>
      ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n),
  },
  {
    rule: "no-accessors",
    severity: "error",
    message:
      "Object.defineProperty with a get/set descriptor defines an accessor",
    match: (n) => ts.isCallExpression(n) && definesAccessor(n),
  },
  {
    rule: "no-modules",
    severity: "error",
    message: "ES modules not supported — output must be one flat script",
    match: (n) => ts.isImportDeclaration(n) || ts.isExportDeclaration(n),
  },
  {
    rule: "no-modules",
    severity: "error",
    message: "require() not supported on device",
    match: (n) => ts.isCallExpression(n) && isNamedCallee(n, "require"),
  },
  {
    rule: "no-labeled-statements",
    severity: "warn",
    message: "labeled statement unverified on device",
    match: (n) => ts.isLabeledStatement(n),
  },
  {
    rule: "no-with",
    severity: "warn",
    message: "with statement unverified on device",
    match: (n) => ts.isWithStatement(n),
  },
  {
    rule: "no-unicode-escapes",
    severity: "warn",
    message: "only \\xHH escapes are supported in device strings",
    match: (n, sf) => ts.isStringLiteral(n) && hasUnicodeEscape(n.getText(sf)),
    fix: (n, sf) => ({
      title: "Replace Unicode escape with raw UTF-8 text",
      start: n.getStart(sf),
      end: n.getEnd(),
      text: JSON.stringify((n as ts.StringLiteral).text),
    }),
  },
];

export function lintSource(
  source: string,
  fileName = SCRIPT_LABEL,
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
    fix?: FindingFix,
  ) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ severity, rule, message, file: fileName, line: line + 1, fix });
  };

  const addFileLevel = (
    rule: string,
    severity: "error" | "warn",
    message: string,
  ) => {
    findings.push({ severity, rule, message, file: fileName });
  };

  const checkTier1 = (node: ts.Node) => {
    for (const r of TIER1_RULES) {
      if (r.match(node, sf)) {
        add(node, r.rule, r.severity, r.message, r.fix?.(node, sf));
      }
    }
  };

  const checkStringRegexMethods = (node: ts.CallExpression) => {
    if (!ts.isPropertyAccessExpression(node.expression)) return;
    const method = node.expression.name.text;
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
    const keyBytes = runtime.byteLength(key);
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
        const bytes = runtime.byteLength(value);
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
    checkStringRegexMethods(node);
    const name = calleeName(node.expression);
    if (!name) return;
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
  findings.push(...checkUseBeforeDefine(sf, fileName));

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

export async function lintScriptFile(path = SCRIPT_PATH): Promise<Finding[]> {
  if (!(await runtime.fs.exists(path))) {
    throw new Error(`script not found: ${path}`);
  }
  return lintSource(await runtime.fs.readText(path), SCRIPT_LABEL);
}
