import { readFileSync, existsSync } from "node:fs";
import ts from "typescript";
import { SCRIPT_PATH } from "./paths.ts";

export type ScriptStats = {
  apis: Record<string, number>;
  registrations: {
    timers: number;
    eventHandlers: number;
    statusHandlers: number;
    httpEndpoints: number;
    rpcHandlers: number;
    mqttSubs: number;
  };
  declarations: {
    vars: number;
    functions: number;
    params: number;
  };
  literals: {
    strings: { count: number; totalBytes: number };
    numbers: { count: number };
  };
  logging: {
    consoleLog: number;
    print: number;
  };
  network: {
    shellyCall: number;
    httpGet: number;
    httpPost: number;
    mqttPublish: number;
  };
  nesting: {
    maxAnonymousDepth: number;
  };
};

const EMPTY: ScriptStats = {
  apis: {},
  registrations: {
    timers: 0,
    eventHandlers: 0,
    statusHandlers: 0,
    httpEndpoints: 0,
    rpcHandlers: 0,
    mqttSubs: 0,
  },
  declarations: { vars: 0, functions: 0, params: 0 },
  literals: {
    strings: { count: 0, totalBytes: 0 },
    numbers: { count: 0 },
  },
  logging: { consoleLog: 0, print: 0 },
  network: { shellyCall: 0, httpGet: 0, httpPost: 0, mqttPublish: 0 },
  nesting: { maxAnonymousDepth: 0 },
};

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function isAnonFunction(node: ts.Node): boolean {
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    return !node.name;
  }
  return false;
}

function calleeName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const left = calleeName(expr.expression);
    if (!left) return null;
    return `${left}.${expr.name.text}`;
  }
  return null;
}

/**
 * Single TS AST walk — dashboard counters + future Tier-2 lint share this.
 */
export function analyzeSource(source: string, fileName = "main.ts"): ScriptStats {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES5,
    true,
    ts.ScriptKind.TS,
  );

  const stats: ScriptStats = structuredClone(EMPTY);
  let anonDepth = 0;

  const visit = (node: ts.Node) => {
    const enteredAnon = isAnonFunction(node);
    if (enteredAnon) {
      anonDepth += 1;
      if (anonDepth > stats.nesting.maxAnonymousDepth) {
        stats.nesting.maxAnonymousDepth = anonDepth;
      }
    }

    if (
      ts.isVariableDeclarationList(node) &&
      !(
        ts.isForStatement(node.parent) ||
        ts.isForInStatement(node.parent) ||
        ts.isForOfStatement(node.parent)
      )
    ) {
      stats.declarations.vars += node.declarations.length;
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      stats.declarations.functions += 1;
      stats.declarations.params += node.parameters.length;
    }
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      if (node.name) stats.declarations.functions += 1;
      stats.declarations.params += node.parameters.length;
    }
    if (ts.isMethodDeclaration(node)) {
      stats.declarations.functions += 1;
      stats.declarations.params += node.parameters.length;
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      stats.literals.strings.count += 1;
      stats.literals.strings.totalBytes += Buffer.byteLength(node.text, "utf8");
    }
    if (ts.isNumericLiteral(node)) {
      stats.literals.numbers.count += 1;
    }

    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name) {
        const known =
          name.startsWith("Shelly.") ||
          name.startsWith("Timer.") ||
          name.startsWith("MQTT.") ||
          name.startsWith("HTTPServer.") ||
          name.startsWith("Script.") ||
          name.startsWith("Virtual.") ||
          name.startsWith("AES.") ||
          name === "print" ||
          name === "console.log" ||
          name === "console.error" ||
          name === "console.warn";
        if (known) bump(stats.apis, name);

        if (name === "Timer.set") stats.registrations.timers += 1;
        if (name === "Shelly.addEventHandler")
          stats.registrations.eventHandlers += 1;
        if (name === "Shelly.addStatusHandler")
          stats.registrations.statusHandlers += 1;
        if (name === "HTTPServer.registerEndpoint")
          stats.registrations.httpEndpoints += 1;
        if (name === "Script.addRpcHandler")
          stats.registrations.rpcHandlers += 1;
        if (name === "MQTT.subscribe") stats.registrations.mqttSubs += 1;

        if (name === "console.log" || name === "console.error" || name === "console.warn") {
          stats.logging.consoleLog += 1;
        }
        if (name === "print") stats.logging.print += 1;

        if (name === "Shelly.call") stats.network.shellyCall += 1;
        if (name === "Shelly.HTTP.get" || name === "HTTP.get")
          stats.network.httpGet += 1;
        if (name === "Shelly.HTTP.post" || name === "HTTP.post")
          stats.network.httpPost += 1;
        if (name === "MQTT.publish") stats.network.mqttPublish += 1;
      }
    }

    ts.forEachChild(node, visit);

    if (enteredAnon) anonDepth -= 1;
  };

  visit(sf);
  return stats;
}

export function analyzeScriptFile(path = SCRIPT_PATH): ScriptStats {
  if (!existsSync(path)) {
    throw new Error(`script not found: ${path}`);
  }
  return analyzeSource(readFileSync(path, "utf8"), path);
}
