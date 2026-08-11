/**
 * The catalog of `Script.Eval` capability probes, one fact per entry.
 *
 * Every expression must stay side-effect-free: it is evaluated inside a script
 * the user owns, on real hardware. Read properties, never call a device method;
 * anything that could throw must catch and return a short string instead, so one
 * bad answer never aborts the run. Answers land in `types/generated-probe.json`
 * keyed by `id`, so ids are API — do not rename them.
 *
 * The list answers the "Must-verify-on-device" items in research index 00:
 * item 1 (the `Array`/`String` surface `types/espruino-lib.d.ts` currently
 * guesses at), item 3 (the anonymous-nesting parse ceiling), item 4 (what "no
 * hoisting" actually does) and the ambiguous globals behind the lint capability
 * gates in `capabilities.ts`.
 */
export type Probe = { id: string; group: string; code: string; note?: string };

/** `typeof <receiver>.<name>`, id-prefixed by group. */
function proto(group: string, receiver: string, names: string[]): Probe[] {
  return names.map((name) => ({
    id: `${group}.${name}`,
    group,
    code: `typeof ${receiver}.${name}`,
  }));
}

/** `typeof <path>` for globals and namespace members — the path is the id. */
function globals(group: string, paths: string[]): Probe[] {
  return paths.map((path) => ({ id: path, group, code: `typeof ${path}` }));
}

/** `depth` nested anonymous functions returning a marker string. */
function nestAnon(depth: number): string {
  let code = `"d${depth}"`;
  for (let i = 0; i < depth; i += 1) code = `(function () { return ${code}; })()`;
  return code;
}

/** Same shape as nestAnon, but every function expression carries a name. */
function nestNamed(depth: number): string {
  let code = `"n${depth}"`;
  for (let i = 0; i < depth; i += 1) {
    code = `(function f${i}() { return ${code}; })()`;
  }
  return code;
}

/**
 * Item 3: the ceiling is a *parse* failure, so the failing depths come back as
 * `ok: false` RPC errors rather than results. The highest depth that returns
 * `"dN"` is the real limit; each IIFE level counts as one anonymous function,
 * which is also the answer to "does an IIFE wrapper count".
 */
const NESTING: Probe[] = [1, 2, 3, 4, 5].map((depth) => ({
  id: `nesting.anon.depth${depth}`,
  group: "parser",
  code: nestAnon(depth),
  note: `${depth} nested anonymous function(s); an RPC error here means the parser refused this depth`,
}));

/**
 * Item 4. Each returns the observed behaviour as a string: `"function"` /
 * `"called"` means the device hoists as ES does, `"undefined"` means the binding
 * exists but is not yet assigned, `"throws:…"` is a ReferenceError, and an RPC
 * error means the declaration-after-use did not even parse. Each is wrapped in
 * one anonymous function, so read them together with `nesting.anon.depth1`.
 */
const HOISTING: Probe[] = [
  {
    id: "hoisting.function-decl",
    group: "parser",
    code:
      '(function () { try { return typeof h; }' +
      ' catch (e) { return "throws:" + (e.message || e); } function h() {} })()',
    note: 'function declaration used before its declaration line; "function" = hoisted',
  },
  {
    id: "hoisting.call",
    group: "parser",
    code:
      '(function () { try { return later(); }' +
      ' catch (e) { return "throws:" + (e.message || e); }' +
      ' function later() { return "called"; } })()',
    note: 'calling a function declared later; "called" = hoisted',
  },
  {
    id: "hoisting.var",
    group: "parser",
    code:
      '(function () { try { return typeof v; }' +
      ' catch (e) { return "throws:" + (e.message || e); } var v = 1; })()',
    note: '"undefined" = var is hoisted without its value, as in ES',
  },
];

/**
 * Item 5 (JsVar block size) is not answerable by an expression. These are the
 * only cheap indirect lead: Espruino's own `process` object. Read the notes
 * before drawing a conclusion from them.
 */
const MEMORY: Probe[] = [
  {
    id: "process",
    group: "memory",
    code: "typeof process",
    note: "Espruino exposes process.memory()/process.env; presence alone proves nothing about JsVar block size",
  },
  {
    id: "process.memory",
    group: "memory",
    code:
      '(function () { try { return process.memory().total + " blocks"; }' +
      ' catch (e) { return "unavailable"; } })()',
    note: "block count of the JS heap; with the heap byte size it brackets 14 vs 16 B, but does not prove sizeof(JsVar) in Shelly's build",
  },
  {
    id: "process.env.ram",
    group: "memory",
    code:
      '(function () { try { return process.env.RAM + "/" + process.env.FLASH; }' +
      ' catch (e) { return "unavailable"; } })()',
    note: "RAM/FLASH bytes of the build; the divisor for process.memory().total, not a JsVar figure",
  },
];

export const PROBES: Probe[] = [
  // Item 1 — the prototype surface a real script reaches for.
  ...proto("array", "[]", [
    "map",
    "forEach",
    "filter",
    "reduce",
    "some",
    "every",
    "find",
    "findIndex",
    "includes",
    "indexOf",
    "lastIndexOf",
    "join",
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "slice",
    "concat",
    "sort",
    "reverse",
  ]),
  ...globals("array", ["Array.isArray"]),
  ...proto("string", '""', [
    "padStart",
    "charAt",
    "charCodeAt",
    "indexOf",
    "lastIndexOf",
    "slice",
    "substring",
    "split",
    "replace",
    "trim",
    "toLowerCase",
    "toUpperCase",
    "concat",
    "includes",
    "startsWith",
    "endsWith",
    "repeat",
  ]),
  ...globals("string", ["String.fromCharCode"]),
  {
    id: "string.byteLength",
    group: "string",
    code: '"á".length',
    note: "2 = strings are UTF-8 byte arrays (plan 01 §2.4), 1 = UTF-16 code units",
  },
  // Globals the language docs leave ambiguous.
  ...globals("global", [
    "JSON.parse",
    "JSON.stringify",
    "Object.keys",
    "Object.values",
    "Object.entries",
    "Object.assign",
    "Math",
    "Math.round",
    "Date",
    "Date.now",
    "parseInt",
    "parseFloat",
    "isNaN",
    "encodeURIComponent",
    "decodeURIComponent",
    "btoa",
    "atob",
    "btoh",
    "ArrayBuffer",
    "Uint8Array",
    "print",
    "console.log",
    "setTimeout",
    "setInterval",
  ]),
  // Device namespaces, including everything the capability gates key on.
  ...globals("device", [
    "Timer",
    "Timer.set",
    "Timer.clear",
    "Timer.getInfo",
    "Shelly.call",
    "Shelly.getComponentStatus",
    "Shelly.getComponentConfig",
    "Shelly.getDeviceInfo",
    "Shelly.getCurrentScriptId",
    "Shelly.getUptimeMs",
    "Shelly.emitEvent",
    "Shelly.addEventHandler",
    "Shelly.addStatusHandler",
    "Script.id",
    "Script.storage",
    "Script.addRpcHandler",
    "Script.getVcHandle",
    "HTTPServer",
    "MQTT",
    "BLE",
    "AES",
  ]),
  ...NESTING,
  {
    id: "nesting.named.depth3",
    group: "parser",
    code: nestNamed(3),
    note: "same depth as nesting.anon.depth3 with named function expressions — if this parses and the anonymous one does not, the limit is about anonymity",
  },
  ...HOISTING,
  ...MEMORY,
];
