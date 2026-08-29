/*
 * FAQ page (`site/faq.html`). Renders `faq-content.ts`; carries no prose.
 *
 * Reuses the docs page's layout classes (`.docs-main`, `.docs-head`,
 * `.docs-toc`, `.docs-section`) rather than growing a second stylesheet for a
 * page with the same shape — one sticky table of contents beside one column of
 * text. Only the question/answer pair is new, and `.faq-q` styles it.
 *
 * Each question gets its own id so an answer can be linked to directly, which
 * is the whole point of a FAQ that people are pointed at rather than browse.
 */
import { Fragment } from "preact";
import { useTheme } from "../shell/theme";
import { SiteHeader, SiteFooter } from "./landing";
import { renderInline } from "./inline";
import { FAQ_GROUPS } from "./faq-content";

export function Faq() {
  const [theme, toggle] = useTheme();

  return (
    <Fragment>
      <SiteHeader theme={theme} toggle={toggle} />

      <main class="site-main docs-main">
        <header class="docs-head">
          <p class="hero-kicker">FAQ</p>
          <h1>Questions, answered honestly.</h1>
          <p class="hero-sub">
            What people use shellint for, what it will not do, and what it does
            not yet promise.
          </p>
        </header>

        <div class="docs-body">
          <nav class="docs-toc" aria-label="On this page">
            <p class="docs-toc-title">On this page</p>
            <ol>
              {FAQ_GROUPS.map((group) => (
                <li key={group.id}>
                  <a href={`#${group.id}`}>{group.title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <article class="docs-article" id="faq">
            {FAQ_GROUPS.map((group) => (
              <section class="docs-section" id={group.id} key={group.id}>
                <h2>
                  <a
                    class="docs-anchor"
                    href={`#${group.id}`}
                    aria-label={`Link to ${group.title}`}
                  >
                    #
                  </a>
                  {group.title}
                </h2>
                {group.items.map((item) => (
                  <div class="faq-item" id={item.id} key={item.id}>
                    <h3 class="faq-q">
                      <a
                        class="docs-anchor"
                        href={`#${item.id}`}
                        aria-label={`Link to “${item.q}”`}
                      >
                        #
                      </a>
                      {item.q}
                    </h3>
                    {item.a.map((para, i) => (
                      <p key={i}>{renderInline(para)}</p>
                    ))}
                  </div>
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
