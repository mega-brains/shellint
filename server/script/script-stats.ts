import runtime from "#shellint/runtime";
import ts from "typescript";
import { DIST_DIR, SCRIPT_PATH } from "../core/paths.ts";

/**
 * 1-based source lines behind each dashboard badge, so a counter can be
 * traced back to the code that produced it. Occurrence order, duplicates kept.
 */
export type StatSites = {
  apis: number[];
  vars: number[];
  functions: number[];
  strings: number[];
  consoleLog: number[];
  print: number[];
  shellyCall: number[];
};

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
    anonFunctions: number;
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
  sites: StatSites;
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
  declarations: { vars: 0, functions: 0, anonFunctions: 0, params: 0 },
  literals: {
    strings: { count: 0, totalBytes: 0 },
    numbers: { count: 0 },
  },
  logging: { consoleLog: 0, print: 0 },
  network: { shellyCall: 0, httpGet: 0, httpPost: 0, mqttPublish: 0 },
  nesting: { maxAnonymousDepth: 0 },
  sites: {
    apis: [],
    vars: [],
    functions: [],
    strings: [],
    consoleLog: [],
    print: [],
    shellyCall: [],
  },
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

/** Shelly/Espruino globals + print/console — shared by call and member sites. */
function isKnownApi(name: string): boolean {
  return (
    name.startsWith("Shelly.") ||
    name.startsWith("Timer.") ||
    name.startsWith("MQTT.") ||
    name.startsWith("HTTPServer.") ||
    name.startsWith("Script.") ||
    name.startsWith("Virtual.") ||
    name.startsWith("AES.") ||
    name.startsWith("BLE.") ||
    name === "print" ||
    name === "console.log" ||
    name === "console.error" ||
    name === "console.warn"
  );
}

/**
 * Outermost property access in a chain that is not a call callee.
 * Avoids triple-counting `BLE.Scanner.Start(...)` as BLE / BLE.Scanner / Start.
 */
function isApiMemberSite(node: ts.PropertyAccessExpression): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    return false;
  }
  if (ts.isCallExpression(parent) && parent.expression === node) {
    return false;
  }
  return true;
}

/** Flat badge metrics — source + each dist variant share this shape. */
export type StatCounters = {
  apiKinds: number;
  apiCalls: number;
  vars: number;
  functions: number;
  anonFunctions: number;
  strings: number;
  stringBytes: number;
  consoleLog: number;
  print: number;
  shellyCall: number;
};

/**
 * Per-variant counters for badge tips. Dist keys omitted when the file is absent.
 * Client shows the compare table only when at least one dist key is present.
 */
export type StatVariants = {
  source: StatCounters;
  debugRaw?: StatCounters;
  debugMin?: StatCounters;
  prodRaw?: StatCounters;
  prodMin?: StatCounters;
};

const DIST_VARIANTS = {
  debugRaw: "debug.raw.js",
  debugMin: "debug.js",
  prodRaw: "prod.raw.js",
  prodMin: "prod.js",
} as const;

export function countersFromStats(stats: ScriptStats): StatCounters {
  const apiCalls = Object.values(stats.apis).reduce((a, b) => a + b, 0);
  return {
    apiKinds: Object.keys(stats.apis).length,
    apiCalls,
    vars: stats.declarations.vars,
    functions: stats.declarations.functions,
    anonFunctions: stats.declarations.anonFunctions,
    strings: stats.literals.strings.count,
    stringBytes: stats.literals.strings.totalBytes,
    consoleLog: stats.logging.consoleLog,
    print: stats.logging.print,
    shellyCall: stats.network.shellyCall,
  };
}

/** Analyze source + existing debug/prod raw+min artifacts (no *.adv.js). */
export async function analyzeVariants(sourceStats: ScriptStats): Promise<StatVariants> {
  const out: StatVariants = { source: countersFromStats(sourceStats) };
  for (const key of Object.keys(DIST_VARIANTS) as (keyof typeof DIST_VARIANTS)[]) {
    const name = DIST_VARIANTS[key];
    const path = runtime.path.join(DIST_DIR, name);
    if (!(await runtime.fs.exists(path))) continue;
    out[key] = countersFromStats(analyzeSource(await runtime.fs.readText(path), name));
  }
  return out;
}

/**
 * Single TS/JS AST walk — dashboard counters + future Tier-2 lint share this.
 */
export function analyzeSource(source: string, fileName = "main.ts"): ScriptStats {
  const kind = fileName.endsWith(".ts") || fileName.endsWith(".tsx")
    ? ts.ScriptKind.TS
    : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES5,
    true,
    kind,
  );

  const stats: ScriptStats = structuredClone(EMPTY);
  let anonDepth = 0;

  const at = (node: ts.Node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const mark = (key: keyof StatSites, node: ts.Node) => {
    stats.sites[key].push(at(node));
  };

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
      for (const d of node.declarations) mark("vars", d);
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      stats.declarations.functions += 1;
      stats.declarations.params += node.parameters.length;
      mark("functions", node);
    }
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      if (node.name) {
        stats.declarations.functions += 1;
        mark("functions", node);
      } else {
        stats.declarations.anonFunctions += 1;
      }
      stats.declarations.params += node.parameters.length;
    }
    if (ts.isMethodDeclaration(node)) {
      stats.declarations.functions += 1;
      stats.declarations.params += node.parameters.length;
      mark("functions", node);
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      stats.literals.strings.count += 1;
      stats.literals.strings.totalBytes += runtime.byteLength(node.text);
      mark("strings", node);
    }
    if (ts.isNumericLiteral(node)) {
      stats.literals.numbers.count += 1;
    }

    // Non-call member uses (e.g. BLE.Scanner.SCAN_RESULT). Call callees are
    // handled below so `BLE.Scanner.Start(...)` stays a single site.
    if (ts.isPropertyAccessExpression(node) && isApiMemberSite(node)) {
      const name = calleeName(node);
      if (name && isKnownApi(name)) {
        bump(stats.apis, name);
        mark("apis", node);
      }
    }

    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name) {
        if (isKnownApi(name)) {
          bump(stats.apis, name);
          mark("apis", node);
        }

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
          mark("consoleLog", node);
        }
        if (name === "print") {
          stats.logging.print += 1;
          mark("print", node);
        }

        if (name === "Shelly.call") {
          stats.network.shellyCall += 1;
          mark("shellyCall", node);
        }
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

export async function analyzeScriptFile(path = SCRIPT_PATH): Promise<ScriptStats> {
  if (!(await runtime.fs.exists(path))) {
    throw new Error(`script not found: ${path}`);
  }
  return analyzeSource(await runtime.fs.readText(path), path);
}
