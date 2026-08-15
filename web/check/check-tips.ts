/**
 * Wrong/right code snippets per lint rule, shown in the same hover tip as the
 * minify options (`web/ui/option-tip.tsx`). Rules with no fixed code shape
 * (inputs group, the dynamic capability checks) are left out — their `about`
 * text alone is the tip.
 */
export type RuleTip = { before: string[]; after: string[] };

export const RULE_TIPS: Record<string, RuleTip> = {
  // dialect
  "no-regexp": {
    before: ["var digits = /^\\d+$/.test(s);"],
    after: ["var digits = s.charAt(0) >= \"0\" && s.charAt(0) <= \"9\";"],
  },
  "no-async": {
    before: ["async function poll() {", "  await Shelly.call(\"Switch.GetStatus\", p);", "}"],
    after: ["function poll(cb) {", "  Shelly.call(\"Switch.GetStatus\", p, cb);", "}"],
  },
  "no-generators": {
    before: ["function* gen() {", "  yield 1;", "}"],
    after: ["function next() {", "  return 1;", "}"],
  },
  "no-accessors": {
    before: ["var o = { get x() { return 1; } };"],
    after: ["var o = { getX: function () { return 1; } };"],
  },
  "no-modules": {
    before: ["import { helper } from \"./util\";"],
    after: ["// one flat script — inline helper instead"],
  },
  "no-labeled-statements": {
    before: ["outer: for (;;) {", "  break outer;", "}"],
    after: ["var done = false;", "for (; !done; ) {", "  done = true;", "}"],
  },
  "no-with": {
    before: ["with (obj) {", "  x = 1;", "}"],
    after: ["obj.x = 1;"],
  },
  "no-unicode-escapes": {
    before: ['"caf\\u00e9"'],
    after: ['"caf\\xe9"'],
  },
  "no-use-before-define": {
    before: ["print(x);", "var x = 1;"],
    after: ["var x = 1;", "print(x);"],
  },

  // caps
  "max-timers": {
    before: ["Timer.set(1000, false, a);", "// … a 6th Timer.set call"],
    after: ["// stay at ≤5 live Timer.set registrations"],
  },
  "max-event-handlers": {
    before: ["Shelly.addEventHandler(cb1); // … a 6th handler"],
    after: ["// stay at ≤5 addEventHandler registrations"],
  },
  "max-status-handlers": {
    before: ["Shelly.addStatusHandler(cb1); // … a 6th handler"],
    after: ["// stay at ≤5 addStatusHandler registrations"],
  },
  "max-http-endpoints": {
    before: ["HTTPServer.registerEndpoint(\"a\", cb); // … a 6th endpoint"],
    after: ["// stay at ≤5 registerEndpoint calls"],
  },
  "max-rpc-handlers": {
    before: ["Script.addRpcHandler(\"A\", cb); // … a 6th handler"],
    after: ["// stay at ≤5 addRpcHandler registrations"],
  },
  "max-mqtt-subscriptions": {
    before: ["MQTT.subscribe(\"t/1\", cb); // … an 11th topic"],
    after: ["// stay at ≤10 MQTT.subscribe topics"],
  },
  "no-registration-in-loop": {
    before: ["for (var i = 0; i < 3; i++) {", "  Timer.set(1000, false, cb);", "}"],
    after: ["Timer.set(1000, false, cb);", "Timer.set(2000, false, cb2);"],
  },
  "max-storage-items": {
    before: ["Shelly.call(\"KVS.Set\", { key: \"k13\", value: v });", "// … a 13th key"],
    after: ["// stay at ≤12 Script.storage keys"],
  },
  "storage-key-length": {
    before: ['Script.storage.setItem("this_key_is_too_long_for_device", v);'],
    after: ['Script.storage.setItem("k1", v);'],
  },
  "storage-value-length": {
    before: ["Script.storage.setItem(\"k\", bigJsonString); // > 1024 B"],
    after: ["Script.storage.setItem(\"k\", trimmedString); // ≤ 1024 B"],
  },
  "rpc-method-name-length": {
    before: ['Script.addRpcHandler("ThisRpcMethodNameIsWayTooLong", cb);'],
    after: ['Script.addRpcHandler("MyMethod", cb);'],
  },
  "no-reserved-rpc-name": {
    before: ['Script.addRpcHandler("GetStatus", cb);'],
    after: ['Script.addRpcHandler("MyStatus", cb);'],
  },

  // semantics
  "rpc-handler-must-respond": {
    before: ["Script.addRpcHandler(\"Foo\", function (req) {", "  doStuff();", "});"],
    after: [
      "Script.addRpcHandler(\"Foo\", function (req, result) {",
      "  doStuff();",
      "  result({ ok: true });",
      "});",
    ],
  },
  "rpc-handler-double-respond": {
    before: [
      "Script.addRpcHandler(\"Foo\", function (req, result, error) {",
      "  result({ ok: true });",
      "  error(-1, \"also this\");",
      "});",
    ],
    after: [
      "Script.addRpcHandler(\"Foo\", function (req, result, error) {",
      "  if (!req.id) return error(-1, \"missing id\");",
      "  result({ ok: true });",
      "});",
    ],
  },
  "http-response-must-send": {
    before: ["HTTPServer.registerEndpoint(\"x\", function (req, res) {", "  doStuff();", "});"],
    after: [
      "HTTPServer.registerEndpoint(\"x\", function (req, res) {",
      "  doStuff();",
      "  res.send(200, \"ok\");",
      "});",
    ],
  },
  "check-call-error-code": {
    before: ['Shelly.call("Switch.Set", p, function (res, err_code, msg) {', "  use(res);", "});"],
    after: [
      'Shelly.call("Switch.Set", p, function (res, err_code, msg) {',
      "  if (err_code) return print(msg);",
      "  use(res);",
      "});",
    ],
  },
  "guard-status-delta": {
    before: ["Shelly.addStatusHandler(function (e) {", "  use(e.delta.temperature);", "});"],
    after: [
      "Shelly.addStatusHandler(function (e) {",
      "  if (e.delta.temperature !== undefined) use(e.delta.temperature);",
      "});",
    ],
  },
  "timer-handle-leak": {
    before: ["h = Timer.set(1000, false, cb);", "h = Timer.set(2000, false, cb2);"],
    after: ["Timer.clear(h);", "h = Timer.set(2000, false, cb2);"],
  },
  "timer-period-min": {
    before: ["Timer.set(5, false, cb);"],
    after: ["Timer.set(10, false, cb);"],
  },
  "reboot-delay-min": {
    before: ["Shelly.reboot(100);"],
    after: ["Shelly.reboot(500);"],
  },
  "no-blocking-loop": {
    before: ["while (true) {", "  poll();", "}"],
    after: ["Timer.set(0, true, poll);"],
  },
  "no-call-in-loop": {
    before: ["for (var i = 0; i < ids.length; i++) {", '  Shelly.call("Switch.Set", { id: ids[i] });', "}"],
    after: [
      "var i = 0;",
      "function step() {",
      '  Shelly.call("Switch.Set", { id: ids[i] }, function () {',
      "    if (++i < ids.length) step();",
      "  });",
      "}",
      "step();",
    ],
  },
  "prefer-sync-component-access": {
    before: ['Shelly.call("Switch.GetStatus", { id: 0 }, cb);'],
    after: ['Shelly.getComponentStatus("switch:0");'],
  },
  "max-anonymous-nesting": {
    before: [
      "Shelly.call(\"A\", p, function () {",
      '  Shelly.call("B", p, function () {',
      '    Shelly.call("C", p, function () {});',
      "  });",
      "});",
    ],
    after: [
      "function onC() {}",
      'function onB() { Shelly.call("C", p, onC); }',
      'Shelly.call("A", p, function () { Shelly.call("B", p, onB); });',
    ],
  },

  // connected
  "component-exists": {
    before: ['Shelly.call("Switch.Set", { id: 5 });  // no switch:5 on this device'],
    after: ['Shelly.call("Switch.Set", { id: 0 });'],
  },
  "no-unknown-rpc-method": {
    before: ['Shelly.call("Foo.Bar", {});  // not in this device\'s ListMethods'],
    after: ['Shelly.call("Switch.Set", { id: 0, on: true });'],
  },
  "warn-preview-api": {
    before: ["BLE.Scanner.Start(opts);  // preview namespace"],
    after: ["if (typeof BLE.Scanner !== \"undefined\") BLE.Scanner.Start(opts);"],
  },
  "probe-absent-api": {
    before: ["Shelly.someNewApi();  // probe read \"undefined\" on this device"],
    after: ['if (typeof Shelly.someNewApi === "function") Shelly.someNewApi();'],
  },

  // advisories
  "no-debug-log-in-prod": {
    before: ['print("motion detected");'],
    after: ['if (meta.env.debug) print("motion detected");'],
  },
  "dead-code": {
    before: ["function unusedHelper() { return 1; }"],
    after: ["// removed — nothing called unusedHelper"],
  },
  "excessive-console-log": {
    before: ["// 25 print()/console.log() call sites in one script"],
    after: ["// consolidate into fewer, guarded log points"],
  },
  "prefer-short-strings": {
    before: ['var HELP = "…(1.4 KB of literal text)…";'],
    after: ["var HELP = \"…\";  // trimmed, or fetched over HTTP instead of resident"],
  },
  "no-concat-in-loop": {
    before: ["var s = \"\";", "for (var i = 0; i < n; i++) s += items[i];"],
    after: ["var parts = [];", "for (var i = 0; i < n; i++) parts.push(items[i]);", 'var s = parts.join("");'],
  },
  "prefer-hoisted-callback": {
    before: ['Shelly.addEventHandler(function (e) { print(e.info.event); });'],
    after: ["function onEvent(e) { print(e.info.event); }", "Shelly.addEventHandler(onEvent);"],
  },
  "max-cognitive-complexity": {
    before: [
      "function f(a, b, c) {",
      "  if (a) { if (b) { if (c) { return 1; } else { return 2; } } }",
      "}",
    ],
    after: [
      "function f(a, b, c) {",
      "  if (!a || !b) return 0;",
      "  return c ? 1 : 2;",
      "}",
    ],
  },
  "meta-vc-role-matches": {
    before: ["Shelly.getVcHandle(\"switch\");  // no matching role in @meta"],
    after: ["/** @meta { \"vc\": [{ \"role\": \"switch\" }] } */", 'Shelly.getVcHandle("switch");'],
  },
  "@meta-must-survive": {
    before: ["// @meta block dropped by a minify pass that strips all comments"],
    after: ["/** @meta … */  // kept — minify config preserves this comment shape"],
  },

  // emit (post-compile guard, on dist/*.raw.js)
  "no-arrow-functions": {
    before: ["var f = (x) => x + 1;"],
    after: ["var f = function (x) { return x + 1; };"],
  },
  "no-classes": {
    before: ["class Foo {", "  bar() {}", "}"],
    after: ["function Foo() {}", "Foo.prototype.bar = function () {};"],
  },
  "no-template-literals": {
    before: ["print(`on: ${state}`);"],
    after: ['print("on: " + state);'],
  },
  "no-destructuring": {
    before: ["var { a, b } = obj;"],
    after: ["var a = obj.a, b = obj.b;"],
  },
  "no-spread-rest": {
    before: ["f(...args);"],
    after: ["f.apply(null, args);"],
  },
};
