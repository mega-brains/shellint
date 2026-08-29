/*
 * Probe explainer (`site/probe.html`) — what the capability probe is, why it
 * exists, and every expression it sends to the device.
 *
 * Same anti-drift contract as `checks.tsx`: the catalog half renders straight
 * from `server/probe/probe-catalog.ts`, the module `mise run probe` itself
 * reads, so a probe added or renamed there shows up here on the next
 * `build:static` with no edit. `probe-catalog.ts` has *no imports at all* —
 * not even a sibling module — so pulling it into the site bundle costs the
 * data and nothing else.
 *
 * Every count on the page is `PROBES.length`. The landing page reads the same
 * constant, so the two can never disagree about how many probes there are.
 */
import { Fragment } from "preact";
import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import { useTheme } from "../shell/theme";
import { highlight } from "./code-highlight";
import { SiteHeader, SiteFooter } from "./landing";
import { PROBES, type Probe } from "../../server/probe/probe-catalog.ts";

/**
 * Human-readable names for the catalog's raw `group` strings. Kept here rather
 * than added to the catalog for the same reason `NEEDS_LABEL` lives in
 * `checks.tsx`: labels are a presentation concern, and no server code has ever
 * needed one — the engine only groups to keep the list navigable.
 */
const GROUP_LABEL: Record<string, { title: string; about: string }> = {
  array: {
    title: "Array methods",
    about: "Which Array.prototype methods this firmware actually ships.",
  },
  string: {
    title: "String methods",
    about: "The String.prototype surface, plus whether a string is bytes or code units.",
  },
  global: {
    title: "Globals",
    about: "JSON, Object, Math, Date and the timer functions the language docs leave ambiguous.",
  },
  device: {
    title: "Device namespaces",
    about: "Shelly.*, Timer.*, Script.*, Virtual, HTTPServer, MQTT, BLE and AES.",
  },
  parser: {
    title: "Parser limits",
    about: "How deep functions may nest, and what hoisting really does here.",
  },
  binary: {
    title: "Binary data",
    about: "ArrayBuffer, typed arrays and the conversions around them.",
  },
  memory: {
    title: "Memory",
    about: "What one JsVar costs and how many of them exist.",
  },
};

/** Catalog order is the reading order; groups appear as they first occur. */
const GROUP_IDS: string[] = [...new Set(PROBES.map((p) => p.group))];

/**
 * The three answers a probe run produces, in the order they matter to someone
 * deciding whether to bother running one.
 */
const GAINS: { title: string; body: string }[] = [
  {
    title: "Typings that match the box",
    body: "types/generated.d.ts is rewritten from the answers, so the editor stops offering APIs this firmware does not have.",
  },
  {
    title: "A lint rule with evidence",
    body: "probe-absent-api reports a name the device answered \"undefined\" for, quoting the expression that measured it.",
  },
  {
    title: "Severity that tells the truth",
    body: "An absence measured on the active device is an error. One inherited from another device, or from firmware it no longer runs, is only a warning.",
  },
];

/**
 * The whole argument for the feature in six lines of real code. `padStart` is
 * genuinely absent on shipping hardware (a Shelly Plus PM answered
 * "undefined" for `typeof "".padStart` on firmware 2.0.0), and the fix has to
 * avoid the name entirely — a `typeof` guard around it would still be a
 * property access, so the rule would still flag it.
 */
const BEFORE = [
  'var hh = String(h).padStart(2, "0");',
  '// probe-absent-api: "padStart" is missing on the active device',
];
const AFTER = [
  'var hh = (h < 10 ? "0" : "") + h;',
  "// no probed absence left in the line",
];

const FAQ: { q: string; a: ComponentChildren }[] = [
  {
    q: "Is it safe to run against a live device?",
    a: (
      <>
        Every expression is a read — <code>typeof</code> or a property access,
        never a device method call — and each one is evaluated on its own, so a
        probe that fails takes no other probe with it.
      </>
    ),
  },
  {
    q: "Do I need a device?",
    a: (
      <>
        Yes. This is the one thing the{" "}
        <a href="./demo/">browser demo</a> cannot fake: a probe is a measurement
        of real hardware. Run it from the{" "}
        <a href="./download.html">downloadable build</a>.
      </>
    ),
  },
  {
    q: "How often should I run one?",
    a: (
      <>
        Once per device, and again after a firmware update. Answers are cached
        per device, and a capture taken on firmware the device no longer runs
        is demoted to a warning rather than trusted.
      </>
    ),
  },
  {
    q: "What happens if I never run one?",
    a: (
      <>
        The rules that need a probe report <strong>skipped</strong> — never a
        pass. See the <a href="./checks.html">checks reference</a> for which
        ones those are.
      </>
    ),
  },
];

function matches(probe: Probe, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    probe.id.toLowerCase().includes(q) ||
    probe.code.toLowerCase().includes(q) ||
    (probe.note ?? "").toLowerCase().includes(q)
  );
}

export function ProbePage() {
  const [theme, toggle] = useTheme();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>("all");

  const shown = useMemo(
    () =>
      PROBES.filter(
        (probe) => (group === "all" || probe.group === group) && matches(probe, query),
      ),
    [query, group],
  );

  const buckets = GROUP_IDS.map((id) => ({
    id,
    rows: shown.filter((probe) => probe.group === id),
  })).filter((b) => b.rows.length > 0);

  return (
    <Fragment>
      <SiteHeader theme={theme} toggle={toggle} />

      <main class="site-main docs-main">
        <header class="docs-head">
          <p class="hero-kicker">Reference</p>
          <h1>Your firmware, not the documentation.</h1>
          <p class="hero-sub">
            A probe asks <em>this</em> Shelly what it can actually do, then
            teaches the editor and the linter the answer. {PROBES.length} small
            expressions, one run, no guessing.
          </p>
        </header>

        <section class="probe-steps" aria-label="How a probe run works">
          <div class="probe-flow">
            <div class="probe-node">
              <span>01</span>
              <strong>Your device</strong>
              <small>model + firmware</small>
            </div>
            <span class="probe-arrow" aria-hidden="true">→</span>
            <div class="probe-node probe-node-active">
              <span>02</span>
              <strong>Script.Eval</strong>
              <small>{PROBES.length} reads</small>
            </div>
            <span class="probe-arrow" aria-hidden="true">→</span>
            <div class="probe-node">
              <span>03</span>
              <strong>Types + lint</strong>
              <small>before you deploy</small>
            </div>
            <p class="probe-note">
              <code>mise run probe</code> sends each expression over the same RPC
              connection shellint already uses, and writes the answers next to
              the device they came from.
            </p>
          </div>
        </section>

        <section class="probe-gains" aria-label="What a probe gives you">
          {GAINS.map((g, index) => (
            <article class="feature" key={g.title}>
              <span class="feature-index" aria-hidden="true">0{index + 1}</span>
              <h2>{g.title}</h2>
              <p>{g.body}</p>
            </article>
          ))}
        </section>

        <section class="probe-case" aria-labelledby="probeCase">
          <div>
            <h2 id="probeCase">One line, one deploy saved</h2>
            <p>
              Nothing about this code is invalid TypeScript, and nothing about
              it fails to compile. It fails at runtime, on the device, at the
              moment the branch is finally taken. A probe turns that into a
              lint finding you read at your desk.
            </p>
          </div>
          <div class="probe-pair">
            {BEFORE.map((line, i) => (
              <span class="check-ex-line diff-del" key={`b${i}`}>
                <span class="check-ex-sign" aria-hidden="true">−</span>
                <code>{highlight(line)}</code>
              </span>
            ))}
            {AFTER.map((line, i) => (
              <span class="check-ex-line diff-add" key={`a${i}`}>
                <span class="check-ex-sign" aria-hidden="true">+</span>
                <code>{highlight(line)}</code>
              </span>
            ))}
          </div>
        </section>

        <section class="probe-faq" aria-label="Probe questions">
          {FAQ.map((item) => (
            <div key={item.q}>
              <h2>{item.q}</h2>
              <p>{item.a}</p>
            </div>
          ))}
        </section>

        <section class="probe-catalog" aria-labelledby="probeCatalog">
          <h2 id="probeCatalog">Every expression it sends</h2>
          <p class="checks-tier-about">
            The catalog below is the one the tool reads. Ids are stable — a
            finding names the probe it came from, and that name is on this page.
          </p>

          <div class="checks-controls">
            <label class="checks-search">
              <span class="sr-only">Filter probes</span>
              <input
                id="probeSearch"
                type="search"
                placeholder="Filter by id, expression or note…"
                value={query}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="checks-group">
              <span class="sr-only">Group</span>
              <select
                id="probeGroup"
                value={group}
                onChange={(e) => setGroup((e.target as HTMLSelectElement).value)}
              >
                <option value="all">All groups</option>
                {GROUP_IDS.map((id) => (
                  <option key={id} value={id}>
                    {GROUP_LABEL[id]?.title ?? id}
                  </option>
                ))}
              </select>
            </label>
            <p class="checks-count" role="status" id="probeCount">
              {shown.length} of {PROBES.length}
            </p>
          </div>

          {buckets.length === 0 ? (
            <p class="release-note" id="probeEmpty">
              No probe matches that filter.
            </p>
          ) : null}

          {buckets.map(({ id, rows }) => (
            <section class="checks-tier" id={`group-${id}`} key={id}>
              <h2>
                {GROUP_LABEL[id]?.title ?? id}{" "}
                <span class="checks-tier-count">{rows.length}</span>
              </h2>
              <p class="checks-tier-about">{GROUP_LABEL[id]?.about ?? ""}</p>
              <table class="docs-table probe-table">
                <thead>
                  <tr>
                    <th>Probe</th>
                    <th>What it evaluates</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Anchored per id so a probe-absent-api finding can link at
                      the exact expression that measured the absence. */}
                  {rows.map((probe) => (
                    <tr id={`probe-${probe.id}`} key={probe.id}>
                      <td>
                        <code>{probe.id}</code>
                      </td>
                      <td class="probe-code">
                        <code>{highlight(probe.code)}</code>
                      </td>
                      <td class="probe-note-cell">{probe.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </section>
      </main>

      <SiteFooter />
    </Fragment>
  );
}
