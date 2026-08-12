export type Sizes = { raw?: number; min?: number; adv?: number };

/** `adv` is absent whenever the tier-3 minifier is unavailable. */
export function formatSizes(pair: Sizes | undefined): string {
  if (!pair) return "—";
  const parts: string[] = [];
  if (pair.raw != null) parts.push(`raw ${pair.raw} B`);
  if (pair.min != null) parts.push(`min ${pair.min} B`);
  if (pair.adv != null) parts.push(`adv ${pair.adv} B`);
  return parts.length ? parts.join(" · ") : "—";
}
