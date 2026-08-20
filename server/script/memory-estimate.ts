import runtime from "#shellint/runtime";
import ts from "typescript";
import { calleeName, parseSource } from "../lint/lint-util.ts";
import { SCRIPT_LABEL, SCRIPT_PATH } from "../core/paths.ts";

export type MemoryEstimate = {
  bytes: number;
  breakdown: {
    variables: number;
    functions: number;
    strings: number;
    numbers: number;
    objects: number;
    logging: number;
  };
  counted: {
    identifiers: number;
    strings: number;
    numbers: number;
    consoleLog: number;
    print: number;
  };
};

/**
 * Community-empirical JsVar costs (LeivoSepp/Shelly-Memory-Optimization).
 * Espruino stores every value in a fixed ~14-byte block, so cost is a step
 * function of length, not a linear one. Tunable: these are measurements from
 * one firmware family, not a documented contract.
 */
export const MEMORY_COSTS = {
  /** Indexed by name-length bucket: 1–4, 5–14, 15–24 chars. */
  varName: [14, 28, 56],
  funcName: [70, 84, 98],
  intSmall: 14,
  intLarge: 28,
  intThreshold: 8192,
  /** 1–9 UTF-8 bytes cost the base; see stringCost for longer strings. */
  stringBase: 28,
  stringStep: 14,
  /** Base for an array or object literal, empty or not. */
  literalBase: 28,
  consoleLog: 42,
  print: 0,
};

const LOG_METHODS = ["console.log", "console.error", "console.warn"];

/**
 * Both buckets are open-ended at the top: a name longer than 24 chars stays in
 * the 15–24 bucket, while a string keeps growing by one JsVar per extra 10
 * bytes past 19. String length is measured in UTF-8 bytes because device
 * strings are byte arrays, not UTF-16 like in the host runtime.
 */
function nameCost(name: string, table: number[]): number {
  if (name.length <= 4) return table[0];
  if (name.length <= 14) return table[1];
  return table[2];
}

function stringCost(text: string): number {
  const bytes = runtime.byteLength(text);
  const { stringBase, stringStep } = MEMORY_COSTS;
  if (bytes <= 9) return stringBase;
  if (bytes <= 19) return stringBase + stringStep;
  return stringBase + stringStep * (1 + Math.ceil((bytes - 19) / 10));
}

function numberCost(text: string): number {
  const value = Math.abs(Number(text));
  // A non-integer never fits the packed-int JsVar, so it takes the wide bucket.
  if (!Number.isInteger(value)) return MEMORY_COSTS.intLarge;
  return value >= MEMORY_COSTS.intThreshold
    ? MEMORY_COSTS.intLarge
    : MEMORY_COSTS.intSmall;
}

function isFunctionValue(expr: ts.Expression | undefined): boolean {
  if (!expr) return false;
  return ts.isFunctionExpression(expr) || ts.isArrowFunction(expr);
}

function declaredName(node: ts.Node): string | null {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node)
    ? node.text
    : null;
}

/** A `{ "key": 1 }` name is charged as a name, so skip it as a string too. */
function isPropertyKey(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    !!parent &&
    (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) &&
    parent.name === node
  );
}

const emptyEstimate = (): MemoryEstimate => ({
  bytes: 0,
  breakdown: {
    variables: 0,
    functions: 0,
    strings: 0,
    numbers: 0,
    objects: 0,
    logging: 0,
  },
  counted: { identifiers: 0, strings: 0, numbers: 0, consoleLog: 0, print: 0 },
});

/**
 * Static RAM estimate from a single TS AST walk — a pre-upload figure to show
 * next to the device's measured `mem_peak`, never a substitute for it. It reads
 * source, so `meta.env` branches that a prod build strips are still counted.
 */
export function estimateMemory(
  source: string,
  fileName = SCRIPT_LABEL,
): MemoryEstimate {
  const sf = parseSource(source, fileName);
  const est = emptyEstimate();
  const { breakdown, counted } = est;

  const addName = (name: string, isFunction: boolean) => {
    const table = isFunction ? MEMORY_COSTS.funcName : MEMORY_COSTS.varName;
    const cost = nameCost(name, table);
    if (isFunction) breakdown.functions += cost;
    else breakdown.variables += cost;
    counted.identifiers += 1;
  };

  const chargeNames = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      addName(node.name.text, isFunctionValue(node.initializer));
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      addName(node.name.text, false);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      addName(node.name.text, true);
    } else if (ts.isFunctionExpression(node) && node.name) {
      addName(node.name.text, true);
    } else if (ts.isMethodDeclaration(node)) {
      const name = declaredName(node.name);
      if (name) addName(name, true);
    } else if (ts.isPropertyAssignment(node)) {
      const name = declaredName(node.name);
      if (name) addName(name, false);
    } else if (ts.isShorthandPropertyAssignment(node)) {
      addName(node.name.text, false);
    }
  };

  const chargeLiterals = (node: ts.Node) => {
    // Only the container base is charged here; members are charged when the
    // walk reaches them, which also covers nested literals.
    if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) {
      breakdown.objects += MEMORY_COSTS.literalBase;
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isPropertyKey(node)) {
        breakdown.strings += stringCost(node.text);
        counted.strings += 1;
      }
    }
    if (ts.isNumericLiteral(node)) {
      breakdown.numbers += numberCost(node.text);
      counted.numbers += 1;
    }
  };

  const chargeLogging = (node: ts.CallExpression) => {
    const name = calleeName(node.expression);
    if (name && LOG_METHODS.includes(name)) {
      breakdown.logging += MEMORY_COSTS.consoleLog;
      counted.consoleLog += 1;
    }
    if (name === "print") {
      breakdown.logging += MEMORY_COSTS.print;
      counted.print += 1;
    }
  };

  const visit = (node: ts.Node) => {
    // Types are erased before the device ever sees the script.
    if (ts.isTypeNode(node) || ts.isTypeAliasDeclaration(node)) return;

    chargeNames(node);
    chargeLiterals(node);
    if (ts.isCallExpression(node)) chargeLogging(node);

    ts.forEachChild(node, visit);
  };

  visit(sf);
  est.bytes = Object.values(breakdown).reduce((sum, part) => sum + part, 0);
  return est;
}

export async function estimateMemoryFile(path = SCRIPT_PATH): Promise<MemoryEstimate> {
  if (!(await runtime.fs.exists(path))) return emptyEstimate();
  return estimateMemory(await runtime.fs.readText(path), SCRIPT_LABEL);
}
