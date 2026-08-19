import { expect, type Page } from "@playwright/test";

/**
 * Bring the check pane's per-rule table (`#checkRules`) into the DOM.
 *
 * Two things hide it from a freshly booted page, and both matter because every
 * open helper here clears localStorage: the inspector shows one tab at a time
 * and defaults to `build` (`web/shell/inspector.tsx`), and the pane's own
 * "rule tiers" group starts collapsed, which unmounts its body outright rather
 * than hiding it (`web/ui/measure.tsx` `Group`). Idempotent — safe to call on a
 * page that is already on the check tab with the group open.
 */
export async function openCheckTab(page: Page) {
  await page.getByTestId("tab-check").click();
  await expect(page.locator("#pane-check")).toBeVisible();
  const tiers = page.getByRole("button", { name: "rule tiers" });
  await expect(tiers).toBeVisible();
  if ((await tiers.getAttribute("aria-expanded")) === "false") await tiers.click();
  await expect(tiers).toHaveAttribute("aria-expanded", "true");
  // Attached, not visible: an empty `.check-rules` is a zero-height flex column,
  // so callers assert on its contents themselves.
  await expect(page.locator("#checkRules")).toBeAttached();
}
