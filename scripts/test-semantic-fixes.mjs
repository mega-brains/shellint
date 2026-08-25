/**
 * Tier 3 autofixes (catalog 3.1 hoist, 3.4 sync component access): the shape of
 * every accepted rewrite, and the preconditions that must refuse one.
 * Usage: node --import tsx scripts/test-semantic-fixes.mjs
 */
import { lintSemantics } from "../server/lint/lint-semantics.ts";
import { previewCheckFixes } from "../server/lint/check-fixes.ts";

const preview = (source) => previewCheckFixes(source, lintSemantics(source));

const fixed = (label, source, expected) => {
  const got = preview(source);
  if (got?.after !== expected) {
    throw new Error(
      `${label}: expected\n---\n${expected}\n---\ngot\n---\n${got?.after ?? "(no fix)"}\n---`,
    );
  }
};

const refused = (label, source) => {
  const got = preview(source);
  if (got) throw new Error(`${label}: expected no fix, got\n---\n${got.after}\n---`);
};

// --- 3.4 prefer-sync-component-access ---------------------------------------

fixed(
  "GetStatus with a used result parameter",
  'Shelly.call("Switch.GetStatus", { id: 0 }, function (res) {\n  print(res.output);\n});',
  'var res = Shelly.getComponentStatus("switch", 0);\nprint(res.output);',
);

fixed(
  "GetConfig maps to getComponentConfig",
  'Shelly.call("Input.GetConfig", { id: 1 }, function (cfg) {\n  print(cfg.type);\n});',
  'var cfg = Shelly.getComponentConfig("input", 1);\nprint(cfg.type);',
);

fixed(
  "no params object means no id argument",
  'Shelly.call("Sys.GetStatus", {}, function (s) {\n  print(s.uptime);\n});',
  'var s = Shelly.getComponentStatus("sys");\nprint(s.uptime);',
);

fixed(
  "an unread result parameter drops the binding",
  'Shelly.call("Switch.GetStatus", { id: 0 }, function (res) {\n  print(1);\n});',
  'Shelly.getComponentStatus("switch", 0);\nprint(1);',
);

fixed(
  "a multi-statement body keeps its relative indentation",
  [
    'if (on) {',
    '  Shelly.call("Switch.GetStatus", { id: 0 }, function (res) {',
    '    if (res.output) {',
    '      print(res.apower);',
    '    }',
    '    print("done");',
    '  });',
    '}',
  ].join("\n"),
  [
    'if (on) {',
    '  var res = Shelly.getComponentStatus("switch", 0);',
    '  if (res.output) {',
    '    print(res.apower);',
    '  }',
    '  print("done");',
    '}',
  ].join("\n"),
);

fixed(
  "declared-but-ignored error parameters are dropped",
  'Shelly.call("Switch.GetStatus", { id: 0 }, function (res, code, msg) {\n  print(res.output);\n});',
  'var res = Shelly.getComponentStatus("switch", 0);\nprint(res.output);',
);

refused(
  "a read error code has no counterpart on the sync accessor",
  'Shelly.call("Switch.GetStatus", { id: 0 }, function (res, code) {\n  if (code !== 0) print(code);\n  print(res);\n});',
);
refused(
  "a read error message has no counterpart either",
  'Shelly.call("Switch.GetStatus", { id: 0 }, function (res, code, msg) {\n  print(msg);\n});',
);
refused(
  "a return would be swallowed by the enclosing scope",
  'function f() {\n  Shelly.call("Switch.GetStatus", { id: 0 }, function (res) {\n    return res;\n  });\n}',
);
refused(
  "extra params have nowhere to go on the accessor",
  'Shelly.call("Switch.GetStatus", { id: 0, extra: 1 }, function (res) {\n  print(res);\n});',
);
refused(
  "a non-literal id cannot be read statically",
  'Shelly.call("Switch.GetStatus", { id: n }, function (res) {\n  print(res);\n});',
);
refused(
  "the result name already binds something else",
  'var res = 1;\nShelly.call("Switch.GetStatus", { id: 0 }, function (res) {\n  print(res);\n});',
);
refused(
  "not a statement — the value is being consumed",
  'var x = [Shelly.call("Switch.GetStatus", { id: 0 }, function (res) {\n  print(res);\n})];',
);
refused(
  "this would rebind after the splice",
  'Shelly.call("Switch.GetStatus", { id: 0 }, function (res) {\n  print(this);\n});',
);

// --- 3.1 max-anonymous-nesting ----------------------------------------------

const nested = (innermost) =>
  [
    'Shelly.addEventHandler(function (a) {',
    '  Timer.set(1000, false, function () {',
    '    Timer.set(2000, false, function () {',
    `      ${innermost}`,
    '    });',
    '  });',
    '});',
  ].join("\n");

fixed(
  "a closure-free depth-3 callback hoists to the top level",
  nested('print("tick");'),
  [
    'function onTimerSet() {',
    '  print("tick");',
    '}',
    '',
    'Shelly.addEventHandler(function (a) {',
    '  Timer.set(1000, false, function () {',
    '    Timer.set(2000, false, onTimerSet);',
    '  });',
    '});',
  ].join("\n"),
);

refused("a callback that closes over an enclosing parameter", nested("print(a);"));
refused("a callback that reads this", nested("print(this);"));
refused("a callback that reads arguments", nested("print(arguments);"));

// A top-level name is unaffected by the move, so it must not block the fix.
const topLevelRead = 'var cfg = 1;\n' + nested("print(cfg);");
if (!preview(topLevelRead)) {
  throw new Error("reading a top-level binding should not refuse the hoist");
}

// A callback that binds the shadowed name itself still closes over nothing.
if (!preview(nested("var a = 1; print(a);"))) {
  throw new Error("a shadowing declaration should not refuse the hoist");
}

// The hoisted name must not collide with something already in the file.
const collision = preview("var onTimerSet = 1;\n" + nested('print("tick");'));
if (!collision?.after.includes("function onTimerSet2(")) {
  throw new Error("a taken hoist name should fall through to a numbered one");
}

console.log("semantic fixes ok");
