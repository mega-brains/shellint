/**
 * Hand-written types for device-pipeline.mjs, following the same pattern as
 * the sibling minify-options.d.mts: the .mjs stays plain JS (so it can be
 * imported node-free from a browser Web Worker later), and this file is its
 * TypeScript-facing signature for server/script consumers.
 */
import type { MinifyConfig } from "./minify-options.d.mts";

export function deviceGlobalDefsFrom(
  profile: Record<string, unknown>,
): Record<string, unknown>;

export function envPass(
  code: string,
  flags: { debug: boolean; prod: boolean },
  deviceDefs: Record<string, unknown>,
  opts?: { dropConsole?: boolean },
): Promise<string>;

export function resolveVariantOptions(
  minifyOpts: MinifyConfig,
  variantName: "debug" | "prod",
): MinifyConfig;

export function minifyPass(code: string, opts: MinifyConfig): Promise<string>;

export type TransformVariantResult = {
  variantOpts: MinifyConfig;
  raw: string;
  min: string;
  interned: { interned: number; savedBytes: number };
};

export function transformVariant(
  tscJs: string,
  name: string,
  flags: { debug: boolean; prod: boolean },
  minifyOpts: MinifyConfig,
  logMapState: { sharedIds: Map<string, string>; shorten: boolean },
  deviceDefs: Record<string, unknown>,
): Promise<TransformVariantResult>;
