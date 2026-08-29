/*
 * Technology / credits page (`site/stack.html`). Renders `stack-content.ts`.
 *
 * Reuses the docs layout classes for the same reason faq.tsx does: same shape,
 * one sticky table of contents beside one column. Each group is a table, since
 * name / version / licence / purpose is genuinely tabular — `.docs-table`
 * already handles the small-screen behaviour.
 *
 * The list is hand-maintained. The page says so out loud rather than letting a
 * reader assume the versions are read from package.json at build time.
 */
import { Fragment } from "preact";
import { useTheme } from "../shell/theme";
import { SiteHeader, SiteFooter } from "./landing";
import { renderInline } from "./inline";
import { STACK_GROUPS } from "./stack-content";
import { repoUrl } from "./release";

export function Stack() {
  const [theme, toggle] = useTheme();

  return (
    <Fragment>
      <SiteHeader theme={theme} toggle={toggle} />

      <main class="site-main docs-main">
        <header class="docs-head">
          <p class="hero-kicker">Built with</p>
          <h1>Standing on other people&rsquo;s work.</h1>
          <p class="hero-sub">
            Every open-source project shellint depends on, what each one is for,
            and the licence it carries.
          </p>
        </header>

        <div class="docs-body">
          <nav class="docs-toc" aria-label="On this page">
            <p class="docs-toc-title">On this page</p>
            <ol>
              {STACK_GROUPS.map((group) => (
                <li key={group.id}>
                  <a href={`#${group.id}`}>{group.title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <article class="docs-article" id="stack">
            {STACK_GROUPS.map((group) => (
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
                <p>{group.about}</p>
                <table class="docs-table stack-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Version</th>
                      <th>Licence</th>
                      <th>What it does here</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.name}>
                        <td>
                          <a href={item.href} target="_blank" rel="noreferrer">
                            {item.name}
                          </a>
                        </td>
                        <td class="stack-version">{item.version}</td>
                        <td class="stack-licence">{item.licence}</td>
                        <td>{renderInline(item.what)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}

            <section class="docs-section" id="notes">
              <h2>
                <a class="docs-anchor" href="#notes" aria-label="Link to Notes">
                  #
                </a>
                Notes
              </h2>
              <p>
                Only direct dependencies are listed, and the versions are
                maintained by hand — check{" "}
                <a href={`${repoUrl()}/blob/main/package.json`} target="_blank" rel="noreferrer">
                  package.json
                </a>{" "}
                for what is actually installed today.
              </p>
              <p>
                shellint itself states no licence yet: the repository carries no
                LICENSE file and no <code>license</code> field. That says nothing
                about the projects above, each of which keeps its own.
              </p>
            </section>
          </article>
        </div>
      </main>

      <SiteFooter />
    </Fragment>
  );
}
