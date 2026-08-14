/**
 * Hand-written types for minify-adv-core.mjs, following the same pattern as
 * the sibling minify-options.d.mts / device-pipeline.d.mts.
 */

export const META_COMMENT: RegExp;

export function reattachMetaAndValidate(
  code: string,
  out: string,
): Promise<{ ok: true; code: string } | { ok: false; reason: string }>;
