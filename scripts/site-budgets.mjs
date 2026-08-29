/**
 * Size budgets for the presentation site's two bundles, in one place.
 *
 * They live here because *two* gate steps assert them —
 * `scripts/test-web-assets.mjs` (as part of the web asset sweep) and
 * `scripts/test-static-bundle.mjs` (as part of the deeper site checks) — and
 * for as long as each carried its own literal, raising one and forgetting the
 * other turned a deliberate rebaseline into a red gate three steps later.
 *
 * Convention, shared with the byte budgets in `scripts/test-web-assets.mjs`:
 * set a new ceiling ~10% above the measured size and say in the comment what
 * grew and why, so the next reader can tell a real regression from a feature
 * that legitimately cost bytes.
 */

/**
 * Rebaselined three times: 60000 B held through the landing, download, docs and
 * checks pages; the probe page (web/site/probe.tsx) then bundled
 * server/probe/probe-catalog.ts the way checks.tsx bundles the check catalog,
 * and 109 probes' ids, expressions and notes plus the page's own prose took
 * ~59.4 KB to ~73.1 KB; then from 80000 B for the FAQ and "built with" pages
 * (web/site/{faq,stack}.tsx and their content modules), ~73.1 KB to ~81.5 KB.
 * Both are prose, so the growth is the copy itself — the two components share
 * the docs page's frame and its inline renderer and add no new machinery.
 */
export const SITE_JS_BUDGET = 92_000;

/**
 * Rebaselined three times: from 12000 B when the docs and checks pages landed
 * (site.entry.css picked up web/site/docs.css and web/ui/option-tip.css, the
 * checks page reusing the app's rule tip verbatim), then from 15000 B for the
 * landing tour — five screenshot rows with their own stage, index badges and
 * gradients, taking ~13.6 KB to ~16.2 KB — then from 17800 B for the probe
 * page's explainer half (~17.4 KB to ~18.8 KB; its catalog half reuses the
 * checks page's control strip and table rules outright).
 */
export const SITE_CSS_BUDGET = 21_000;
