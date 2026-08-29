/*
 * Docs page (`site/docs.html`). Renders `docs-content.ts`: layout lives here,
 * prose does not, and the inline renderer is shared with faq.tsx.
 *
 * One long scroll with a sticky table of contents, not a page per topic:
 * GitHub Pages has no SPA rewrite, so each extra topic would cost another HTML
 * shell, `data-page` branch and build-static.mjs copy entry. The FAQ is the
 * one topic that earned all three — it is what a visitor arrives looking for.
 */
import { Fragment } from "preact";
import { useTheme } from "../shell/theme";
import { SiteHeader, SiteFooter } from "./landing";
import { renderInline } from "./inline";
import { DOC_SECTIONS, type Block } from "./docs-content";

function DocBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return <p>{renderInline(block.text)}</p>;
    case "code":
      return (
        <pre class="docs-code">
          <code>{block.text}</code>
        </pre>
      );
    case "list": {
      const items = block.items.map((item) => <li key={item}>{renderInline(item)}</li>);
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "table":
      return (
        <table class="docs-table">
          <thead>
            <tr>
              {block.head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) => (
                  <td key={i}>{renderInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "warn":
      return (
        <p class="docs-warn" role="note">
          <span aria-hidden="true">⚠</span> {renderInline(block.text)}
        </p>
      );
  }
}

export function Docs() {
  const [theme, toggle] = useTheme();

  return (
    <Fragment>
      <SiteHeader theme={theme} toggle={toggle} />

      <main class="site-main docs-main">
        <header class="docs-head">
          <p class="hero-kicker">Documentation</p>
          <h1>Everything shellint does, and what it refuses to do.</h1>
          <p class="hero-sub">
            Install, workspace, build, checks and device — plus the security
            posture to read before binding a port.
          </p>
        </header>

        <div class="docs-body">
          {/* Sticky, so a reader deep in the checks section still sees the
              page shape. `aria-label` because the page already has two other
              navs (header, footer). */}
          <nav class="docs-toc" aria-label="On this page">
            <p class="docs-toc-title">On this page</p>
            <ol>
              {DOC_SECTIONS.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <article class="docs-article" id="docs">
            {DOC_SECTIONS.map((section) => (
              <section class="docs-section" id={section.id} key={section.id}>
                <h2>
                  <a class="docs-anchor" href={`#${section.id}`} aria-label={`Link to ${section.title}`}>
                    #
                  </a>
                  {section.title}
                </h2>
                {section.blocks.map((block, i) => (
                  <DocBlock block={block} key={i} />
                ))}
              </section>
            ))}
          </article>
        </div>
      </main>

      <SiteFooter />
    </Fragment>
  );
}
