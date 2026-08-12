export type Sizes = { raw?: number; min?: number; adv?: number };

export type SizeTint = "low" | "high";

export function isEmptySizes(s: Sizes): boolean {
  return s.raw == null && s.min == null && s.adv == null;
}

/** Byte cell for the sizes table; missing values render as an em dash. */
export function formatSizeCell(n: number | undefined): string {
  return n != null ? `${n} B` : "—";
}

/** True when either mode has an adv artifact (tier-3 minify present). */
export function hasAdvColumn(debug?: Sizes, prod?: Sizes): boolean {
  return debug?.adv != null || prod?.adv != null;
}

/** Min/max across all numeric size cells (skip empty/`—`). Null if none. */
export function sizeExtent(
  debug: Sizes,
  prod: Sizes,
  showAdv: boolean,
): { min: number; max: number } | null {
  const vals: number[] = [];
  for (const s of [debug, prod]) {
    if (s.raw != null) vals.push(s.raw);
    if (s.min != null) vals.push(s.min);
    if (showAdv && s.adv != null) vals.push(s.adv);
  }
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

/** Tint for a cell: lowest → low, highest → high; none when min===max or empty. */
export function sizeTint(
  n: number | undefined,
  extent: { min: number; max: number } | null,
): SizeTint | null {
  if (n == null || extent == null || extent.min === extent.max) return null;
  if (n === extent.min) return "low";
  if (n === extent.max) return "high";
  return null;
}
