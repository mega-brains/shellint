/**
 * shellint dialect bans, as ESLint flat config for your own
 * Shelly script repo — for editor and CI, where shellint Check
 * button cannot reach.
 *
 * **This is a template, not part of shellint.** shellint neither installs nor
 * runs ESLint; its own 64 checks are hand-rolled TypeScript-AST passes, because
 * no linter can express the cooperative scheduler, the RAM budget, `Shelly.*`
 * existence, or the live capability probe. See
 * `.claude/plans/2026-08-15_19_lint-gaps-and-eslint.md` for why.
 *
 * What this config *does* cover is the syntax half of Tier 1 — the JS the
 * Espruino build on the device does not implement. That half needs no custom
 * rule code at all: it is `no-restricted-syntax` plus a handful of selectors.
 *
 * Install:
 *   npm i -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
 *   npm i -D eslint-plugin-es-x        # optional, see the block at the bottom
 *
 * Version notes, current as of 2026-08-15:
 *   - `eslint-plugin-es-x@10` peers on `eslint >= 10.6`. On ESLint 9, pin 9.7.0.
 *   - `@typescript-eslint`'s `ban-types` was removed in v8 — `no-restricted-types`
 *     is its replacement, and needs no `parserOptions.project`.
 *   - Do **not** reach for `eslint-plugin-es5` or `eslint-plugin-ecmascript-compat`.
 *     Both throw at rule load under flat config on ESLint 9 and 10.
 */
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

/**
 * Written against the TypeScript *source*, not the emitted script. Anything
 * `tsc --target es5` legally down-levels — arrow functions, template literals,
 * destructuring, spread, `let`/`const`, `for-of`, classes — is deliberately
 * absent here: banning it in source would be banning your own compiler's input.
 * Assert on emit instead, like shellint post-compile guard.
 */
const DIALECT_BANS = [
  // No RegExp on device. All three spellings, including the bare call.
  { selector: "Literal[regex]", message: "No RegExp on device." },
  { selector: "NewExpression[callee.name='RegExp']", message: "No RegExp on device." },
  { selector: "CallExpression[callee.name='RegExp']", message: "No RegExp on device." },

  // No Promise: device APIs are callback-based.
  {
    selector: "NewExpression[callee.name='Promise']",
    message: "No Promise on device — take a callback.",
  },
  {
    selector: "MemberExpression[object.name='Promise']",
    message: "No Promise on device — take a callback.",
  },
  {
    selector: ":function[async=true]",
    message: "No async functions — the device has no Promise.",
  },
  { selector: "AwaitExpression", message: "No await — the device has no Promise." },

  // Not in the accepted dialect.
  { selector: ":function[generator=true]", message: "No generator functions on device." },
  { selector: "YieldExpression", message: "No yield on device." },
  { selector: "Property[kind=/^(get|set)$/]", message: "No get/set accessors on device." },
  {
    selector: "MethodDefinition[kind=/^(get|set)$/]",
    message: "No get/set accessors on device.",
  },
  { selector: "WithStatement", message: "`with` is undocumented on the device parser." },
  {
    selector: "LabeledStatement",
    message: "Labeled statements are undocumented on the device parser.",
  },

  // The output is one flat script: nothing may survive as a module.
  { selector: "ImportDeclaration", message: "No ES modules — the device runs one flat script." },
  { selector: "ImportExpression", message: "No dynamic import on device." },
  { selector: "TSImportEqualsDeclaration", message: "No import = require() on device." },
  {
    selector: "ExportNamedDeclaration, ExportDefaultDeclaration, ExportAllDeclaration",
    message: "No ES modules — the device runs one flat script.",
  },
  { selector: "CallExpression[callee.name='require']", message: "No require() on device." },

  // Device strings are byte arrays: only \xHH, and non-ASCII goes in as raw UTF-8.
  //
  // Note the escaping. The selector esquery must receive is
  // `Literal[raw=/\\u/]` — a regex matching a backslash then `u` — which is
  // four backslashes here, because the JS string literal eats one pair. It
  // matches the literal's raw source text, so it will not catch an escape
  // inside an identifier (`var a`).
  {
    selector: "Literal[raw=/\\\\u/]",
    message: "Only \\xHH escapes are supported in device strings.",
  },
];

export default [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      // The device is neither Node nor a browser. Declare only what it has.
      globals: {
        Shelly: "readonly",
        Timer: "readonly",
        MQTT: "readonly",
        BLE: "readonly",
        HTTPServer: "readonly",
        Script: "readonly",
        print: "readonly",
        console: "readonly",
        JSON: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-restricted-syntax": ["error", ...DIALECT_BANS],

      // Type-layer bans. A `.d.ts` that never declares these is still the
      // better mechanism — this catches the ones that slip in by annotation.
      "@typescript-eslint/no-restricted-types": [
        "error",
        {
          types: {
            Promise: "The device has no Promise — device APIs take a callback.",
            RegExp: "The device has no RegExp.",
            Symbol: "The device has no Symbol.",
            Map: "The device has no Map — use a plain object.",
            Set: "The device has no Set — use a plain object.",
          },
        },
      ],

      // Espruino does not hoist. `functions: false` on purpose: a callback
      // calling a helper defined further down the file is the device idiom and
      // is safe, because the callback runs long after the script has parsed.
      "no-use-before-define": ["warn", { functions: false, variables: true }],

      // The docs put the parser's anonymous-nesting limit at 2; a probed
      // Plus1PM on fw 1.7.5 ran 5. Warn between the two.
      "max-nested-callbacks": ["warn", 3],

      // Every byte and every JsVar is resident device RAM.
      "no-unused-vars": ["warn", { args: "after-used" }],
    },
  },
];

/**
 * Optional, and only worth adding if you are writing plain JS rather than
 * TypeScript with a restricted `lib`: `eslint-plugin-es-x` bans the ES6+
 * *globals* `tsc` cannot down-level.
 *
 *   import esx from "eslint-plugin-es-x";
 *   // …then in `plugins`: { "es-x": esx }, and in `rules`:
 *   "es-x/no-promise": "error",
 *   "es-x/no-symbol": "error",
 *   "es-x/no-map": "error",
 *   "es-x/no-set": "error",
 *   "es-x/no-proxy": "error",
 *   "es-x/no-reflect": "error",
 *   "es-x/no-typed-arrays": "error",
 *   "es-x/no-bigint": "error",
 *   "es-x/no-weakrefs": "error",
 *   "es-x/no-global-this": "error",
 *   "es-x/no-accessor-properties": "error",
 *
 * Three traps, all verified:
 *   - Never adopt its `restrict-to-es5` / `restrict-to-es3` presets. They flag
 *     what tsc legally down-levels, and miss the real hazard: `noEmitHelpers`
 *     means async/generators/spread emit `__awaiter`/`__generator`/`__assign`
 *     calls that are never defined, so the device throws a ReferenceError.
 *   - `no-accessor-properties` lives in `restrict-to-es3`, not `restrict-to-es5`.
 *   - Leave `settings["es-x"].aggressive` **off**. With the TS parser it is
 *     unnecessary, and it false-positives on device interfaces.
 *
 * There is no `es-x/no-regexp` and there never will be — RegExp is ES3, so the
 * plugin cannot express that ban by construction. The selectors above are the
 * only way to get it.
 */
