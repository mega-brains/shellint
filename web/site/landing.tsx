/*
 * Landing page (`site/index.html`, M26 plan §6.1). This is the front door for
 * a visitor who has never seen DevRoom: what it is, why the size/lint story
 * matters, and two ways in — the in-browser demo or the downloadable
 * executable. It shares tokens.css and the app's Button/theme so the site
 * reads as the same product as the app it links to, not a marketing skin
 * bolted on top.
 *
 * `SiteHeader`/`SiteFooter` are exported for `download.tsx` to reuse — one
 * definition each, kept here rather than in a third file because the build
 * contract (M26 plan §5) names exactly the files under web/site/ and neither
 * page owns the other, so co-locating on the page that renders first is the
 * least surprising place.
 */
import { Fragment } from "preact";
import { Button } from "../ui/button";
import { Group } from "../ui/measure";
import { useTheme } from "../shell/theme";
import { repoUrl } from "./release";

/**
 * The hero screenshot, in the theme the visitor is actually looking at — a
 * light shot of the app on a dark page (or the reverse) reads as a screenshot
 * of some *other* program.
 *
 * Driven off `useTheme()` rather than a `<picture>` with a
 * `prefers-color-scheme` `<source>`: `<picture>` only ever sees the OS
 * preference, so it would ignore the header's theme toggle. Swapping `src`
 * also means the browser fetches one image, not both — two ~250 KB PNGs, one
 * of them `display: none`, is still two downloads.
 *
 * Both files are 1620×908; the box crops the bottom (see `.hero-shot` in
 * site.css), which is why the dashboard rail sits high in the frame.
 */
function HeroShot() {
  const [theme] = useTheme();
  return (
    <div class="hero-shot" style={{ aspectRatio: "1620 / 660" }}>
      <img
        src={theme === "dark" ? "./devroom-header-dark.png" : "./devroom-header.png"}
        width={1620}
        height={908}
        alt="DevRoom's editor, build dashboard and device dock"
        loading="eager"
      />
    </div>
  );
}

export function SiteHeader() {
  const [theme, toggle] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <header class="site-top">
      <a class="site-wordmark" href="./">
        <span class="wordmark-dot" aria-hidden="true" />
        <span>DevRoom</span>
      </a>
      <nav class="site-nav">
        <a href="./demo/">Demo</a>
        <a href="./download.html">Download</a>
        <a href={repoUrl()} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </nav>
      <Button
        class="chip chip-icon"
        id="themeToggle"
        onClick={toggle}
        title={`Switch to the ${next} theme`}
        aria-label={`Switch to the ${next} theme`}
      >
        <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
      </Button>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer class="site-footer">
      {/* No licence is claimed here on purpose: the repo carries no LICENSE
          file and no `license` field in package.json, so stating one would be
          a claim the project has not actually made. Add the line back once a
          licence lands. */}
      <span>A local playground for Shelly Gen2 scripts.</span>
      <a href={repoUrl()} target="_blank" rel="noreferrer">
        Source on GitHub
      </a>
    </footer>
  );
}

const FEATURES: { title: string; body: string }[] = [
  {
    title: "66 compliance checks, five tiers",
    body: "Source lint through post-compile dialect guard, including device-profile- and capability-probe-aware rules. Parse and type errors land on the editor gutter, not just a status line.",
  },
  {
    title: "Size is a first-class metric",
    body: "Debug/prod × raw/minified/advanced artifacts, a size sparkline over history, and a JsVar memory estimate checked against the device's live mem_peak.",
  },
  {
    title: "Build-time env gating",
    body: "meta.env.debug/meta.env.prod dead-code-eliminate whole branches; production also shortens log strings into a map the log panel re-expands.",
  },
  {
    title: "A real device loop",
    body: "Multi-device and slot selection, WS PutCode deploy, live status and eco toggle, streamed debug logs, and a 104-probe capability scan of what the box actually supports.",
  },
];

/**
 * #site itself is the mount point declared in index.html; this component
 * fills it (a fragment, not a wrapping div) so the root's id stays unique.
 */
export function Landing() {
  return (
    <Fragment>
      <SiteHeader />

      <main class="site-main">
        <section class="hero">
          <h1>
            Author Shelly Gen2 scripts in TypeScript. Lint them against the
            Espruino subset. Watch the size budget.
          </h1>
          <p class="hero-sub">
            A local development playground for Shelly Gen2 device scripts —
            type safety, device-aware linting and a memory/size dashboard, in
            front of a real device or entirely offline.
          </p>
          <div class="hero-cta">
            <a class="site-btn site-btn-primary" id="ctaDemo" href="./demo/">
              Try it in the browser
            </a>
            <a class="site-btn" id="ctaDownload" href="./download.html">
              Download
            </a>
          </div>
          <HeroShot />
        </section>

        <section class="features">
          {FEATURES.map((f) => (
            <article class="feature" key={f.title}>
              <h2>{f.title}</h2>
              <p>{f.body}</p>
            </article>
          ))}
        </section>

        <section class="limits">
          <Group title="What the demo cannot do" id="limits">
            <p>
              The demo at <code>./demo/</code> runs entirely in your browser — no
              server, no device, works offline. The 14 lint rules that need a
              device profile or capability probe report <em>skipped</em>, not
              pass or fail, and there is no live device panel, deploy or logs.
              <a href="./download.html"> Download the local version</a> for the
              full loop.
            </p>
          </Group>
        </section>
      </main>

      <SiteFooter />
    </Fragment>
  );
}
