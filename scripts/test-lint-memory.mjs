/**
 * Tier 5, the allocation and complexity rules: `server/lint/lint-memory.ts` and
 * `server/lint/lint-complexity.ts`. Split out of test-smoke.mjs to keep that
 * file under the 500-line limit.
 * Usage: node --import tsx scripts/test-lint-memory.mjs
 */
import ts from "typescript";
import { lintAdvisories } from "../server/lint/lint-advisories.ts";
import { cognitiveComplexity } from "../server/lint/lint-complexity.ts";

const advise = (src) => lintAdvisories(src, "t.ts", "/nonexistent-dist");
const expect = (src, rule, want) => {
  const hit = new Set(advise(src).map((f) => f.rule)).has(rule);
  if (hit !== want) {
    throw new Error(`${rule} should ${want ? "" : "not "}fire on: ${src}`);
  }
};
const adv = (src, rule) => expect(src, rule, true);
const advNot = (src, rule) => expect(src, rule, false);

// no-concat-in-loop — quadratic growth on a device heap.
adv('var out = ""; for (var i = 0; i < 3; i++) { out += "x"; }', "no-concat-in-loop");
adv('var out = ""; for (var i = 0; i < 3; i++) { out = out + i; }', "no-concat-in-loop");
adv("var a = []; for (var i = 0; i < 3; i++) { a = a.concat([i]); }", "no-concat-in-loop");
// A numeric counter is the same syntax and must stay quiet.
advNot("var n = 0; for (var i = 0; i < 3; i++) { n += 1; }", "no-concat-in-loop");
advNot("var n = 0; for (var i = 0; i < 3; i++) { n = n + i; }", "no-concat-in-loop");
advNot('var out = ""; out += "x"; print(out);', "no-concat-in-loop");

// prefer-hoisted-callback — a function object allocated per call, for nothing.
adv(
  'function h() { Timer.set(10, false, function () { print("hi"); }); }\nh();',
  "prefer-hoisted-callback",
);
advNot(
  "function h(id) { Timer.set(10, false, function () { print(id); }); }\nh(1);",
  "prefer-hoisted-callback",
);
advNot(
  "function h() { var v = 1; Timer.set(10, false, function () { print(v); }); }\nh();",
  "prefer-hoisted-callback",
);
// Already top level — there is nothing to hoist it out of.
advNot('Timer.set(10, false, function () { print("hi"); });', "prefer-hoisted-callback");

// Cognitive complexity, checked against SonarSource's own worked example: the
// spec says 7 for this function, and matching it is what makes the score mean
// what its name claims.
const scoreOf = (src) =>
  cognitiveComplexity(
    ts.createSourceFile("s.ts", src, ts.ScriptTarget.ES5, true).statements[0],
  );
const sumScore = scoreOf(`function sumOfPrimes(max) {
  var total = 0;
  OUT: for (var i = 1; i <= max; ++i) {
    for (var j = 2; j < i; ++j) { if (i % j === 0) { continue OUT; } }
    total += i;
  }
  return total;
}`);
if (sumScore !== 7) {
  throw new Error(
    `cognitive complexity of SonarSource's sumOfPrimes should be 7, got ${sumScore}`,
  );
}
// Nesting is the whole point: three flat ifs must cost less than three nested.
const flat = "function f() { if (a) { x(); } if (b) { y(); } if (c) { z(); } }";
const nested = "function f() { if (a) { if (b) { if (c) { z(); } } } }";
if (scoreOf(nested) <= scoreOf(flat)) {
  throw new Error("nested ifs must cost more than the same count of flat ifs");
}
const deep = "if (a) { if (b) { if (c) { if (d) { x(); } } } }";
adv(`function big() { ${deep} ${deep} }`, "max-cognitive-complexity");
advNot("function small() { if (a) { x(); } }", "max-cognitive-complexity");

console.log("OK: tier-5 concat-in-loop / hoistable-callback / cognitive-complexity");
