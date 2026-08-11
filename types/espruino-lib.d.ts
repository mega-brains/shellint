/**
 * Minimal ES5-ish ambient for Shelly Gen2 Espruino scripts.
 *
 * Omits Promise, Symbol, and RegExp (unsupported on device).
 * Full lib.es5 trim is iterative — widen/narrow after device probes.
 *
 * Array/String: declare the documented core; do not treat missing methods as a
 * hard ban list (runtime surface is still being confirmed). Prefer confirmed
 * methods (push/pop/indexOf/slice) in new code.
 */

interface Object {
  toString(): string;
  valueOf(): unknown;
  hasOwnProperty(v: string): boolean;
}

interface ObjectConstructor {
  new (value?: unknown): Object;
  (value?: unknown): Object;
  keys(o: object): string[];
}

declare var Object: ObjectConstructor;

interface Function {
  apply(thisArg: unknown, argArray?: unknown[]): unknown;
  call(thisArg: unknown, ...argArray: unknown[]): unknown;
  /** Espruino extension */
  replaceWith(newFunc: Function): void;
}

interface FunctionConstructor {
  new (...args: string[]): Function;
  (...args: string[]): Function;
}

declare var Function: FunctionConstructor;

/**
 * Globals tsc itself requires under `noLib`. They exist to satisfy the checker,
 * not to describe device capability — hence the minimal bodies.
 */
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {
  [index: number]: unknown;
  length: number;
}
/**
 * Declared as a bare type with no constructor and no members on purpose: the
 * device has no RegExp, so a literal or a method call on one must not typecheck.
 * Rule 1.1 `no-regexp` gives the readable message.
 */
interface RegExp {}

interface String {
  readonly length: number;
  charAt(pos: number): string;
  charCodeAt(index: number): number;
  // No concat(): `typeof "".concat` answered "undefined" on the probed device
  // (Plus1PM, fw 1.7.5). Use `+`.
  indexOf(searchString: string, position?: number): number;
  lastIndexOf(searchString: string, position?: number): number;
  slice(start?: number, end?: number): string;
  substring(start: number, end?: number): string;
  toLowerCase(): string;
  toUpperCase(): string;
  trim(): string;
  toString(): string;
  valueOf(): string;
}

interface StringConstructor {
  new (value?: unknown): String;
  (value?: unknown): string;
  readonly prototype: String;
  fromCharCode(...codes: number[]): string;
}

declare var String: StringConstructor;

interface Number {
  toFixed(fractionDigits?: number): string;
  toString(radix?: number): string;
  valueOf(): number;
}

interface NumberConstructor {
  new (value?: unknown): Number;
  (value?: unknown): number;
  readonly prototype: Number;
  readonly MAX_VALUE: number;
  readonly MIN_VALUE: number;
  readonly NaN: number;
  readonly NEGATIVE_INFINITY: number;
  readonly POSITIVE_INFINITY: number;
  isNaN(number: number): boolean;
  isFinite(number: number): boolean;
}

declare var Number: NumberConstructor;

interface Boolean {
  valueOf(): boolean;
}

interface BooleanConstructor {
  new (value?: unknown): Boolean;
  (value?: unknown): boolean;
  readonly prototype: Boolean;
}

declare var Boolean: BooleanConstructor;

interface Array<T> {
  length: number;
  push(...items: T[]): number;
  pop(): T | undefined;
  indexOf(searchElement: T, fromIndex?: number): number;
  slice(start?: number, end?: number): T[];
  [n: number]: T;
}

interface ArrayConstructor {
  new <T>(...items: T[]): T[];
  <T>(...items: T[]): T[];
  readonly prototype: Array<unknown>;
  isArray(arg: unknown): arg is unknown[];
}

declare var Array: ArrayConstructor;

interface Math {
  readonly E: number;
  readonly LN10: number;
  readonly LN2: number;
  readonly LOG2E: number;
  readonly LOG10E: number;
  readonly PI: number;
  readonly SQRT1_2: number;
  readonly SQRT2: number;
  abs(x: number): number;
  acos(x: number): number;
  asin(x: number): number;
  atan(x: number): number;
  atan2(y: number, x: number): number;
  ceil(x: number): number;
  cos(x: number): number;
  exp(x: number): number;
  floor(x: number): number;
  log(x: number): number;
  max(...values: number[]): number;
  min(...values: number[]): number;
  pow(x: number, y: number): number;
  random(): number;
  round(x: number): number;
  sin(x: number): number;
  sqrt(x: number): number;
  tan(x: number): number;
}

declare var Math: Math;

interface Date {
  getTime(): number;
  getFullYear(): number;
  getMonth(): number;
  getDate(): number;
  getHours(): number;
  getMinutes(): number;
  getSeconds(): number;
  getMilliseconds(): number;
  getDay(): number;
  toISOString(): string;
  toString(): string;
  valueOf(): number;
}

interface DateConstructor {
  new (): Date;
  new (value: number | string): Date;
  new (
    year: number,
    monthIndex: number,
    date?: number,
    hours?: number,
    minutes?: number,
    seconds?: number,
    ms?: number
  ): Date;
  (): string;
  readonly prototype: Date;
  now(): number;
  parse(s: string): number;
  UTC(
    year: number,
    monthIndex: number,
    date?: number,
    hours?: number,
    minutes?: number,
    seconds?: number,
    ms?: number
  ): number;
}

declare var Date: DateConstructor;

interface JSON {
  parse(text: string): unknown;
  stringify(value: unknown): string;
}

declare var JSON: JSON;

declare function parseInt(string: string, radix?: number): number;
declare function parseFloat(string: string): number;
declare function isNaN(number: number): boolean;
declare function isFinite(number: number): boolean;
declare function encodeURIComponent(uriComponent: string): string;
declare function decodeURIComponent(encodedURIComponent: string): string;

/** Hex encode a string (Shelly utility). */
declare function btoh(str: string): string;
/** Base64 encode. */
declare function btoa(str: string): string;
/** Base64 decode. */
declare function atob(b64: string): string;

// Explicitly NOT declared (unsupported on Shelly Espruino):
// - Promise / async / await
// - Symbol
// - RegExp / /.../ literals
