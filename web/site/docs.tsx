/*
 * Docs page (`site/docs.html`). Renders `docs-content.ts` — this file owns
 * layout and the tiny inline-markup renderer, and carries no prose of its own.
 *
 * The renderer handles exactly three inline forms (`code`, [label](href),
 * **bold**) because those are the three the content uses; anything richer
 * would mean shipping a Markdown parser to a site that deliberately has no
 * runtime dependencies beyond Preact.
 *
 * Sections are one long scroll with a sticky table of contents rather than one
 * page per topic: GitHub Pages has no SPA rewrite, so every extra topic would
 * otherwise cost another HTML shell, another `data-page` branch and another
 * entry in build-static.mjs's copy loop.
 */
import { Fragment, type ComponentChildren } from "preact";
import { useTheme } from "../shell/theme";
import { SiteHeader, SiteFooter } from "./landing";
import { DOC_SECTIONS, type Block } from "./docs-content";

/** `code` | [label](href) | **bold** — see the file header for why only these. */
const INLINE = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;

function renderInline(text: string): ComponentChildren {
  const out: ComponentChildren[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1] !== undefined) {
      out.push(<code>{m[1]}</code>);
    } else if (m[2] !== undefined && m[3] !== undefined) {
      const external = m[3].startsWith("http");
      out.push(
        <a href={m[3]} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
          {m[2]}
        </a>,
      );
    } else {
      out.push(<strong>{m[4]}</strong>);
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

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
            Install, the workspace, the build, the checks and the device — plus
            the security posture you should read before binding a port.
          </p>
        </header>

        <div class="docs-body">
          {/* Sticky, so a reader deep in the checks section can still see the
              shape of the page. `aria-label` because there are already two
              other navs on the page (header, footer). */}
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
