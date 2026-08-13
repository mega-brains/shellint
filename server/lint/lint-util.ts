import ts from "typescript";

export type Finding = {
  severity: "error" | "warn";
  rule: string;
  message: string;
  file?: string;
  line?: number;
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
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      findings.push({ severity, rule, message, file: fileName, line: line + 1 });
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
