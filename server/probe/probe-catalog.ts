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

/** Dotted paths can throw when their root is absent, as Script.id did on fw 1.4.99. */
function guardedGlobals(group: string, paths: string[]): Probe[] {
  return paths.map((path) => ({
    id: path,
    group,
    code: `(function(){try{return typeof ${path};}catch(e){return "throws:"+(e.message||e);}})()`,
  }));
}

/** Bare namespace checks explain a guarded member's `throws:` answer. */
function namespaceRoots(group: string, paths: string[]): Probe[] {
  return paths.map((path) => ({
    id: path,
    group,
    code: `typeof ${path}`,
    note: `"undefined" means ${path} is missing; member probes return throws: instead.`,
  }));
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
 * `typeof Uint8Array` in the `global` group only proves the binding exists.
 * Typed arrays arrived with `ArrayBuffer` (fw 1.6.0, Gen3/Gen4), and Espruino's
 * flat-string backing makes construction, indexing and the ArrayBuffer
 * round-trip separate facts. Every answer is a string, so a missing constructor
 * reads as `throws:…` rather than aborting the entry.
 */
const TYPED_ARRAY: Probe[] = [
  {
    id: "binary.uint8.construct",
    group: "binary",
    code:
      '(function () { try { return typeof new Uint8Array(2); }' +
      ' catch (e) { return "throws:" + (e.message || e); } })()',
    note: '"object" = the constructor is usable, not just bound',
  },
  {
    id: "binary.uint8.size",
    group: "binary",
    code:
      '(function () { try { return "" + new Uint8Array(4).length; }' +
      ' catch (e) { return "throws:" + (e.message || e); } })()',
    note: '"4" = the length argument is honoured',
  },
  {
    id: "binary.uint8.element",
    group: "binary",
    code:
      '(function () { try { return typeof new Uint8Array(2)[0]; }' +
      ' catch (e) { return "throws:" + (e.message || e); } })()',
    note: '"number" = indexed reads work and the buffer is zero-filled',
  },
  {
    id: "binary.uint8.overBuffer",
    group: "binary",
    code:
      '(function () { try { return "" + new Uint8Array(new ArrayBuffer(3)).length; }' +
      ' catch (e) { return "throws:" + (e.message || e); } })()',
    note: '"3" = a view over an ArrayBuffer works — the shape the AES API takes',
  },
  {
    id: "binary.uint8.backing",
    group: "binary",
    code:
      '(function () { try { return typeof new Uint8Array(2).buffer; }' +
      ' catch (e) { return "throws:" + (e.message || e); } })()',
    note: '"object" = the view exposes its backing ArrayBuffer',
  },
  {
    id: "binary.uint8.methods",
    group: "binary",
    code:
      '(function () { try { var a = new Uint8Array(1);' +
      ' return typeof a.set + "/" + typeof a.fill + "/" + typeof a.subarray' +
      ' + "/" + typeof a.slice; }' +
      ' catch (e) { return "throws:" + (e.message || e); } })()',
    note: 'set/fill/subarray/slice in that order; one compound answer so an absent typed-array method never shadows the same name on Array or Timer',
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

/**
 * Virtual component API (https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Virtual).
 * `getHandle` on a key that almost certainly does not exist is side-effect-free
 * (returns null, no RPC); if the device happens to have one, reading `typeof` on
 * its methods never invokes them, so this stays safe either way.
 */
const VIRTUAL: Probe[] = [
  {
    id: "virtual.getHandle.call",
    group: "device",
    code:
      '(function () { try { var h = Virtual.getHandle("boolean:200");' +
      ' return h === null ? "null" : typeof h; }' +
      ' catch (e) { return "throws:" + (e.message || e); } })()',
    note: '"null" = no component at that key (expected on most devices); "object" = one exists — either way proves getHandle is callable',
  },
  {
    id: "virtual.instance.methods",
    group: "device",
    code:
      '(function(){try{var h=Virtual.getHandle("boolean:200");if(!h)return "none";' +
      'return typeof h.setValue+"/"+typeof h.getValue+"/"+typeof h.getStatus+"/"+typeof h.getConfig+"/"+typeof h.setConfig;' +
      '}catch(e){return "throws:"+(e.message||e);}})()',
    note: 'setValue/getValue/getStatus/getConfig/setConfig in that order; only reachable when a boolean:200 component exists',
  },
  {
    id: "virtual.instance.events",
    group: "device",
    code:
      '(function(){try{var h=Virtual.getHandle("boolean:200");if(!h)return "none";' +
      'return typeof h.on+"/"+typeof h.off;' +
      '}catch(e){return "throws:"+(e.message||e);}})()',
    note: 'on/off in that order; only reachable when a boolean:200 component exists',
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
  ...namespaceRoots("array", ["Array"]),
  ...guardedGlobals("array", ["Array.isArray"]),
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
  ...namespaceRoots("string", ["String"]),
  ...guardedGlobals("string", ["String.fromCharCode"]),
  {
    id: "string.byteLength",
    group: "string",
    code: '"á".length',
    note: "2 = strings are UTF-8 byte arrays (plan 01 §2.4), 1 = UTF-16 code units",
  },
  // Globals the language docs leave ambiguous.
  ...namespaceRoots("global", ["JSON", "Object", "console"]),
  ...guardedGlobals("global", [
    "JSON.parse",
    "JSON.stringify",
    "Object.keys",
    "Object.values",
    "Object.entries",
    "Object.assign",
  ]),
  ...globals("global", [
    "Math",
    "Date",
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
    "setTimeout",
    "setInterval",
  ]),
  ...guardedGlobals("global", ["Math.round", "Date.now", "console.log"]),
  // Device namespaces, including everything the capability gates key on.
  ...namespaceRoots("device", ["Shelly", "Script"]),
  ...globals("device", [
    "Timer",
    "Virtual",
    "HTTPServer",
    "MQTT",
    "BLE",
    "AES",
  ]),
  ...guardedGlobals("device", [
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
    "Virtual.getHandle",
  ]),
  ...NESTING,
  {
    id: "nesting.named.depth3",
    group: "parser",
    code: nestNamed(3),
    note: "same depth as nesting.anon.depth3 with named function expressions — if this parses and the anonymous one does not, the limit is about anonymity",
  },
  ...HOISTING,
  ...TYPED_ARRAY,
  ...VIRTUAL,
  ...MEMORY,
];
