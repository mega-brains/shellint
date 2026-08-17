import ts from "typescript";

export type Finding = {
  severity: "error" | "warn";
  rule: string;
  message: string;
  file?: string;
  line?: number;
  fix?: FindingFix;
};

export type FindingFix = {
  title: string;
  start: number;
  end: number;
  text: string;
};

/** Dotted name of a call target: `Timer.set`, `Script.storage.setItem`, … */
export function calleeName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const left = calleeName(expr.expression);
    return left ? `${left}.${expr.name.text}` : null;
  }
  return null;
}

/** Literal or identifier key of an object-literal member: `{ get: … }`, `{ "get": … }`. */
function propertyKey(prop: ts.ObjectLiteralElementLike): string | null {
  if (!prop.name) return null;
  return ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name)
    ? prop.name.text
    : null;
}

/**
 * `Object.defineProperty(o, "k", { get: … })` — an accessor under another
 * name, and the shape tsc's ES5 emit turns a class getter into.
 */
export function definesAccessor(node: ts.CallExpression): boolean {
  if (calleeName(node.expression) !== "Object.defineProperty") return false;
  const descriptor = node.arguments[2];
  if (!descriptor || !ts.isObjectLiteralExpression(descriptor)) return false;
  return descriptor.properties.some((p) => {
    const key = propertyKey(p);
    return key === "get" || key === "set";
  });
}

/**
 * True when `raw` (a literal's source text) carries a live `\uXXXX` escape.
 * The backslash run before the `u` must be odd: in `"a\\ub"` the first
 * backslash escapes the second, leaving a plain `u` the device accepts.
 */
export function hasUnicodeEscape(raw: string): boolean {
  for (let i = 1; i < raw.length; i += 1) {
    if (raw[i] !== "u") continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && raw[j] === "\\"; j -= 1) slashes += 1;
    if (slashes % 2 === 1) return true;
  }
  return false;
}

export function stringArg(node: ts.CallExpression, index: number): string | null {
  const arg = node.arguments[index];
  if (!arg) return null;
  return ts.isStringLiteralLike(arg) ? arg.text : null;
}

export function numberArg(node: ts.CallExpression, index: number): number | null {
  const arg = node.arguments[index];
  if (!arg) return null;
  if (ts.isNumericLiteral(arg)) return Number(arg.text);
  if (
    ts.isPrefixUnaryExpression(arg) &&
    arg.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(arg.operand)
  ) {
    return -Number(arg.operand.text);
  }
  return null;
}

/** Numeric value of `{ prop: 42 }` in an object-literal argument. */
export function objectNumberProp(
  arg: ts.Expression | undefined,
  prop: string,
): number | null {
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
  for (const p of arg.properties) {
    if (!ts.isPropertyAssignment(p) || !p.name) continue;
    const key =
      ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)
        ? p.name.text
        : null;
    if (key === prop && ts.isNumericLiteral(p.initializer)) {
      return Number(p.initializer.text);
    }
  }
  return null;
}

export function functionArg(
  node: ts.CallExpression,
  index: number,
): ts.FunctionExpression | ts.ArrowFunction | null {
  const arg = node.arguments[index];
  if (!arg) return null;
  return ts.isFunctionExpression(arg) || ts.isArrowFunction(arg) ? arg : null;
}

/** Depth-first search for any node matching `predicate`. */
export function findNode(
  root: ts.Node,
  predicate: (node: ts.Node) => boolean,
): ts.Node | null {
  let hit: ts.Node | null = null;
  const visit = (node: ts.Node) => {
    if (hit) return;
    if (predicate(node)) {
      hit = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return hit;
}

export function hasNode(
  root: ts.Node,
  predicate: (node: ts.Node) => boolean,
): boolean {
  return findNode(root, predicate) !== null;
}

/** Collects findings with source positions resolved against one source file. */
export function createSink(sf: ts.SourceFile, fileName: string) {
  const findings: Finding[] = [];
  return {
    findings,
    at(
      node: ts.Node,
      rule: string,
      severity: Finding["severity"],
      message: string,
      fix?: FindingFix,
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      findings.push({ severity, rule, message, file: fileName, line: line + 1, fix });
    },
    file(rule: string, severity: Finding["severity"], message: string) {
      findings.push({ severity, rule, message, file: fileName });
    },
  };
}

export type Sink = ReturnType<typeof createSink>;

export function parseSource(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES5,
    true,
    ts.ScriptKind.TS,
  );
}
