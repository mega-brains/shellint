import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { SCRIPT_PATH } from "./paths.ts";
import {
  calleeName,
  createSink,
  functionArg,
  hasNode,
  numberArg,
  objectNumberProp,
  parseSource,
  stringArg,
  type Finding,
  type Sink,
} from "./lint-util.ts";

/**
 * Tier 3 — Espruino/Shelly semantics: the rules neither the type system nor a
 * generic linter can express. Errors are reserved for failures the device
 * cannot survive (parse error, crash, rejected value); heuristics stay warns.
 */
export const SEMANTIC_LIMITS = {
  /** Anonymous callbacks nested deeper than this fail to parse on device. */
  maxAnonymousNesting: 2,
  minTimerPeriodMs: 10,
  minRebootDelayMs: 500,
  /** A literal loop bound above this blocks the cooperative scheduler. */
  maxLiteralLoopBound: 100000,
};

const RESPOND_METHODS = ["result", "error"];

function isCallTo(node: ts.Node, name: string): boolean {
  return ts.isCallExpression(node) && calleeName(node.expression) === name;
}

function isMethodCall(node: ts.Node, methods: string[]): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    methods.includes(node.expression.name.text)
  );
}

function isAnonFunction(
  node: ts.Node,
): node is ts.FunctionExpression | ts.ArrowFunction {
  return (
    (ts.isFunctionExpression(node) && !node.name) || ts.isArrowFunction(node)
  );
}

function isLoop(node: ts.Node): boolean {
  return (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  );
}

function isTruthyLiteral(expr: ts.Expression | undefined): boolean {
  if (!expr) return true;
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  return ts.isNumericLiteral(expr) && Number(expr.text) !== 0;
}

function hasEscapeHatch(body: ts.Node): boolean {
  return hasNode(
    body,
    (n) =>
      ts.isBreakStatement(n) ||
      ts.isReturnStatement(n) ||
      ts.isThrowStatement(n),
  );
}

/** `i < 500000` style bound, for the busy-loop advisory. */
function literalLoopBound(node: ts.ForStatement): number | null {
  const cond = node.condition;
  if (!cond || !ts.isBinaryExpression(cond)) return null;
  const op = cond.operatorToken.kind;
  const isUpper =
    op === ts.SyntaxKind.LessThanToken ||
    op === ts.SyntaxKind.LessThanEqualsToken;
  if (!isUpper || !ts.isNumericLiteral(cond.right)) return null;
  return Number(cond.right.text);
}

function referencesIdentifier(body: ts.Node, name: string): boolean {
  return hasNode(body, (n) => ts.isIdentifier(n) && n.text === name);
}

/**
 * A callback body that never responds leaves the caller waiting for the
 * device's own timeout (5 s for RPC, 10 s for HTTP), with no error anywhere.
 */
function checkResponds(
  sink: Sink,
  call: ts.CallExpression,
  callbackIndex: number,
  methods: string[],
  rule: string,
  what: string,
) {
  const cb = functionArg(call, callbackIndex);
  if (!cb) return;
  if (!hasNode(cb.body, (n) => isMethodCall(n, methods))) {
    sink.at(cb, rule, "error", `${what} never responds — the caller times out`);
  }
}

/** Two responses in one straight-line block: the second is silently dropped. */
function checkDoubleRespond(sink: Sink, call: ts.CallExpression) {
  const cb = functionArg(call, 1);
  if (!cb || !ts.isBlock(cb.body)) return;

  const visitBlock = (block: ts.Block) => {
    let responded: ts.Node | null = null;
    for (const stmt of block.statements) {
      if (ts.isReturnStatement(stmt)) return;
      if (!ts.isExpressionStatement(stmt)) continue;
      if (!isMethodCall(stmt.expression, RESPOND_METHODS)) continue;
      if (responded) {
        sink.at(
          stmt,
          "rpc-handler-double-respond",
          "warn",
          "RPC handler responds twice in the same block — the second response is dropped",
        );
        return;
      }
      responded = stmt;
    }
  };

  const walk = (node: ts.Node) => {
    if (ts.isBlock(node)) visitBlock(node);
    ts.forEachChild(node, walk);
  };
  walk(cb.body);
}

function checkShellyCall(sink: Sink, node: ts.CallExpression) {
  const method = stringArg(node, 0);
  if (method) {
    const sync = /\.(GetStatus|GetConfig)$/.exec(method);
    if (sync && !method.startsWith("Shelly.")) {
      const suggested =
        sync[1] === "GetStatus" ? "getComponentStatus" : "getComponentConfig";
      sink.at(
        node,
        "prefer-sync-component-access",
        "warn",
        `Shelly.call("${method}") — Shelly.${suggested}() is synchronous and does not consume one of the 5 call slots`,
      );
    }
    if (method === "Shelly.Reboot") {
      const delay = objectNumberProp(node.arguments[1], "delay_ms");
      if (delay != null && delay < SEMANTIC_LIMITS.minRebootDelayMs) {
        sink.at(
          node,
          "reboot-delay-min",
          "warn",
          `Shelly.Reboot delay_ms=${delay} is below the ${SEMANTIC_LIMITS.minRebootDelayMs} ms minimum`,
        );
      }
    }
  }

  const cb = functionArg(node, 2);
  if (!cb) return;
  const errorParam = cb.parameters[1];
  const errorName =
    errorParam && ts.isIdentifier(errorParam.name) ? errorParam.name.text : null;
  if (!errorName || !referencesIdentifier(cb.body, errorName)) {
    sink.at(
      cb,
      "check-call-error-code",
      "warn",
      "Shelly.call callback ignores error_code — failures pass silently",
    );
  }
}

/** `status.delta` carries changed keys only; unguarded reads are undefined. */
function checkStatusDelta(
  sink: Sink,
  node: ts.PropertyAccessExpression,
  guards: string[],
) {
  const inner = node.expression;
  if (!ts.isPropertyAccessExpression(inner) || inner.name.text !== "delta") {
    return;
  }
  const key = node.name.text;
  if (guards.some((g) => g.includes(key))) return;
  sink.at(
    node,
    "guard-status-delta",
    "warn",
    `delta.${key} read without a presence check — delta carries changed keys only`,
  );
}

type TimerVar = { live: boolean };

export function lintSemantics(
  source: string,
  fileName = "scripts/main.ts",
): Finding[] {
  const sf = parseSource(source, fileName);
  const sink = createSink(sf, fileName);
  const guards: string[] = [];
  const timers = new Map<string, TimerVar>();
  let anonDepth = 0;
  let loopDepth = 0;

  const trackTimerAssignment = (
    node: ts.Node,
    name: string,
    fromTimerSet: boolean,
  ) => {
    const state = timers.get(name);
    if (state?.live) {
      sink.at(
        node,
        "timer-handle-leak",
        "warn",
        `${name} still holds a live timer handle — call Timer.clear(${name}) before reassigning`,
      );
    }
    if (fromTimerSet) timers.set(name, { live: true });
    else if (state) state.live = false;
  };

  const checkTimerHandles = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isCallTo(node.initializer, "Timer.set")
    ) {
      timers.set(node.name.text, { live: true });
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      trackTimerAssignment(node, node.left.text, isCallTo(node.right, "Timer.set"));
      return;
    }
    if (isCallTo(node, "Timer.clear")) {
      const handle = (node as ts.CallExpression).arguments[0];
      if (handle && ts.isIdentifier(handle)) {
        const state = timers.get(handle.text);
        if (state) state.live = false;
      }
    }
  };

  const checkLoop = (node: ts.Node) => {
    const infinite =
      (ts.isWhileStatement(node) && isTruthyLiteral(node.expression)) ||
      (ts.isDoStatement(node) && isTruthyLiteral(node.expression)) ||
      (ts.isForStatement(node) && isTruthyLiteral(node.condition));
    if (infinite) {
      const body = (node as ts.IterationStatement).statement;
      if (!hasEscapeHatch(body)) {
        sink.at(
          node,
          "no-blocking-loop",
          "error",
          "loop never exits — the device scheduler is cooperative and will not preempt it",
        );
      }
      return;
    }
    if (ts.isForStatement(node)) {
      const bound = literalLoopBound(node);
      if (bound != null && bound > SEMANTIC_LIMITS.maxLiteralLoopBound) {
        sink.at(
          node,
          "no-blocking-loop",
          "warn",
          `loop bound ${bound} blocks the scheduler for a long time — split the work across Timer.set callbacks`,
        );
      }
    }
  };

  const checkCall = (node: ts.CallExpression) => {
    const name = calleeName(node.expression);
    if (name === "Shelly.call") {
      if (loopDepth > 0) {
        sink.at(
          node,
          "no-call-in-loop",
          "error",
          "Shelly.call inside a loop — the device allows only 5 concurrent calls",
        );
      }
      checkShellyCall(sink, node);
    }
    if (name === "Script.addRpcHandler") {
      checkResponds(sink, node, 1, RESPOND_METHODS, "rpc-handler-must-respond", "RPC handler");
      checkDoubleRespond(sink, node);
    }
    if (name === "HTTPServer.registerEndpoint") {
      checkResponds(sink, node, 1, ["send"], "http-response-must-send", "HTTP endpoint");
    }
    if (name === "Timer.set") {
      const period = numberArg(node, 0);
      if (period != null && period < SEMANTIC_LIMITS.minTimerPeriodMs) {
        sink.at(
          node,
          "timer-period-min",
          "error",
          `Timer.set period ${period} ms is below the ${SEMANTIC_LIMITS.minTimerPeriodMs} ms device minimum`,
        );
      }
    }
  };

  const visit = (node: ts.Node) => {
    const enteredAnon = isAnonFunction(node);
    if (enteredAnon) {
      anonDepth += 1;
      if (anonDepth > SEMANTIC_LIMITS.maxAnonymousNesting) {
        sink.at(
          node,
          "max-anonymous-nesting",
          "error",
          `anonymous function nested ${anonDepth} deep — the device parser handles at most ${SEMANTIC_LIMITS.maxAnonymousNesting}; hoist it to a named function`,
        );
      }
    }

    checkTimerHandles(node);
    if (isLoop(node)) checkLoop(node);
    if (ts.isCallExpression(node)) checkCall(node);
    if (ts.isPropertyAccessExpression(node)) {
      checkStatusDelta(sink, node, guards);
    }

    const guard = ts.isIfStatement(node)
      ? node.expression
      : ts.isConditionalExpression(node)
        ? node.condition
        : null;
    if (guard) guards.push(guard.getText(sf));
    const enteredLoop = isLoop(node);
    if (enteredLoop) loopDepth += 1;

    ts.forEachChild(node, visit);

    if (enteredLoop) loopDepth -= 1;
    if (guard) guards.pop();
    if (enteredAnon) anonDepth -= 1;
  };

  visit(sf);
  return sink.findings;
}

export function lintSemanticsFile(path = SCRIPT_PATH): Finding[] {
  if (!existsSync(path)) {
    throw new Error(`script not found: ${path}`);
  }
  return lintSemantics(readFileSync(path, "utf8"), "scripts/main.ts");
}
