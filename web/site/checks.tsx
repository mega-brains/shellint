/*
 * Checks reference (`site/checks.html`) — every rule shellint can run, with
 * the one-line rationale it carries in the tool.
 *
 * The table is rendered straight from `server/lint/check-catalog.ts`, the same
 * module the app and the offline demo read (`web/static/local-api.ts` imports
 * it identically), so this page cannot drift from the engine: a rule added,
 * renamed or re-tiered there shows up here on the next `build:static` with no
 * edit at all. That is the whole reason the page exists as code instead of as
 * another section of hand-written prose in `docs-content.ts`.
 *
 * `CHECK_CATALOG` reaches into server/ but pulls in nothing Node-ish — the
 * only import below it is `capabilities.ts`, plain data — so the site bundle
 * stays small.
 */
import { Fragment } from "preact";
import { useMemo, useState } from "preact/hooks";
import { useTheme } from "../shell/theme";
import { RULE_TIPS, type RuleTip } from "../check/check-tips";
import { highlight } from "./code-highlight";
import { SiteHeader, SiteFooter } from "./landing";
import {
  CHECK_CATALOG,
  CHECK_GROUPS,
  type CheckNeeds,
  type CheckSpec,
} from "../../server/lint/check-catalog.ts";

/**
 * What a `needs` value costs a reader: which of them the browser demo has to
 * report `skipped` for, and why. Kept here rather than in the catalog because
 * it is a presentation concern — the engine only needs the discriminator.
 */
const NEEDS_LABEL: Record<CheckNeeds, string> = {
  profile: "device profile",
  probe: "capability probe",
  artifacts: "a build",
  types: "types/*.d.ts",
  parse: "a parsing script",
};

/**
 * The wrong/right pair for one rule, revealed by hovering (or focusing) the ±
 * badge in the Example column. Deliberately *not* the app's `OptTip`: that one
 * portals to `document.body` and positions itself against the app's `#side`
 * column, which a documentation page does not have. This is plain CSS —
 * `.check-ex` is `position: relative`, the card is absolute inside it and
 * shown on `:hover`/`:focus-within` — so there is no positioning code, no
 * portal and no state on this page at all.
 *
 * The pairs themselves are still `web/check/check-tips.ts`, the same map the
 * app's check pane reads, so an example only ever exists in one place.
 */
function Example({ rule, tip }: { rule: string; tip: RuleTip }) {
  return (
    <span class="check-ex">
      {/* A button, not a bare span: it has to be tabbable for the card to be
          reachable without a pointer. It does nothing on click — hover and
          focus are the whole interaction. */}
      <button type="button" class="check-ex-badge" aria-describedby={`ex-${rule}`}>
        <span aria-hidden="true">±</span>
        <span class="sr-only">Code example for {rule}</span>
      </button>
      <span class="check-ex-card" id={`ex-${rule}`} role="tooltip">
        {tip.before.map((line, i) => (
          <span class="check-ex-line diff-del" key={`b${i}`}>
            <span class="check-ex-sign" aria-hidden="true">−</span>
            <code>{highlight(line)}</code>
          </span>
        ))}
        {tip.after.map((line, i) => (
          <span class="check-ex-line diff-add" key={`a${i}`}>
            <span class="check-ex-sign" aria-hidden="true">+</span>
            <code>{highlight(line)}</code>
          </span>
        ))}
      </span>
    </span>
  );
}

function matches(spec: CheckSpec, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return spec.rule.toLowerCase().includes(q) || spec.about.toLowerCase().includes(q);
}

export function Checks() {
  const [theme, toggle] = useTheme();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>("all");

  const shown = useMemo(
    () =>
      CHECK_CATALOG.filter(
        (spec) => (group === "all" || spec.group === group) && matches(spec, query),
      ),
    [query, group],
  );

  // Catalog order is the tier order; grouping preserves it inside each bucket.
  const buckets = CHECK_GROUPS.map((g) => ({
    group: g,
    rows: shown.filter((spec) => spec.group === g.id),
  })).filter((b) => b.rows.length > 0);

  return (
    <Fragment>
      <SiteHeader theme={theme} toggle={toggle} />

      <main class="site-main docs-main">
        <header class="docs-head">
          <p class="hero-kicker">Reference</p>
          <h1>{CHECK_CATALOG.length} checks, five tiers, one guard.</h1>
          <p class="hero-sub">
            Every rule shellint runs against a Shelly Gen2+ script, straight from
            the catalog the tool itself reads. Tiers 1–3 need nothing but your
            source; tier 4 needs a device. See the{" "}
            <a href="./docs.html#checks">docs</a> for how a run reports them.
          </p>
        </header>

        <div class="checks-controls">
          <label class="checks-search">
            <span class="sr-only">Filter checks</span>
            <input
              id="checkSearch"
              type="search"
              placeholder="Filter by rule or rationale…"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="checks-group">
            <span class="sr-only">Tier</span>
            <select
              id="checkGroup"
              value={group}
              onChange={(e) => setGroup((e.target as HTMLSelectElement).value)}
            >
              <option value="all">All tiers</option>
              {CHECK_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <p class="checks-count" role="status" id="checkCount">
            {shown.length} of {CHECK_CATALOG.length}
          </p>
        </div>

        {buckets.length === 0 ? (
          <p class="release-note" id="checkEmpty">
            No check matches that filter.
          </p>
        ) : null}

        {buckets.map(({ group: g, rows }) => (
          <section class="checks-tier" id={`tier-${g.id}`} key={g.id}>
            <h2>
              {g.label} <span class="checks-tier-count">{rows.length}</span>
            </h2>
            <p class="checks-tier-about">{g.about}</p>
            <table class="docs-table checks-table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>What it catches</th>
                  <th>Needs</th>
                  <th class="checks-ex-head">Example</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((spec) => (
                  // Anchored per rule so a finding in the app, an issue or a
                  // commit message can link at the exact rationale.
                  <tr id={`check-${spec.rule}`} key={spec.rule}>
                    <td>
                      <code>{spec.rule}</code>
                    </td>
                    <td>{spec.about}</td>
                    <td class="checks-needs">
                      {spec.needs ? NEEDS_LABEL[spec.needs] : "—"}
                    </td>
                    {/* Nothing lives only behind the badge — the rationale is
                        in its own column, so a touch device that cannot hover
                        loses the snippet, not the rule. */}
                    <td class="checks-ex-cell">
                      {RULE_TIPS[spec.rule] ? (
                        <Example rule={spec.rule} tip={RULE_TIPS[spec.rule]!} />
                      ) : (
                        <span class="checks-ex-none" aria-hidden="true">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        <p class="checks-foot">
          A rule whose prerequisite is missing reports <strong>skipped</strong>,
          never a pass — which is why the{" "}
          <a href="./demo/">browser demo</a> skips the rules in the
          &ldquo;Needs&rdquo; column rather than claiming your script is clean.
          Hover a <span class="check-ex-badge check-ex-inline" aria-hidden="true">±</span>{" "}
          to see the wrong/right pair the tool shows for that rule.
        </p>
      </main>

      <SiteFooter />
    </Fragment>
  );
}
