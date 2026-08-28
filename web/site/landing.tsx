/*
 * Landing page (`site/index.html`, M26 plan §6.1). This is the front door for
 * a visitor who has never seen shellint: size and lint story
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
import { useTheme, type Theme } from "../shell/theme";
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
function HeroShot({ theme }: { theme: Theme }) {
  return (
    <div class="hero-window">
      <div class="hero-window-bar" aria-hidden="true">
        <span class="window-lights"><i /><i /><i /></span>
        <span>scripts/main.ts</span>
        <span class="window-state">ready</span>
      </div>
      <div class="hero-shot" style={{ aspectRatio: "1620 / 660" }}>
        <img
          src={theme === "dark" ? "./shellint-header-dark.png" : "./shellint-header.png"}
          width={1620}
          height={908}
          alt="shellint editor, build dashboard and device dock"
          loading="eager"
        />
      </div>
    </div>
  );
}

export function SiteHeader({ theme, toggle }: { theme: Theme; toggle: () => void }) {
  const next = theme === "dark" ? "light" : "dark";
  return (
    <header class="site-top">
      <a class="site-wordmark" href="./">
        <span class="wordmark-dot" aria-hidden="true" />
        <span>shellint</span>
      </a>
      <nav class="site-nav">
        <a class="chip" href="./demo/">Demo <span aria-hidden="true">→</span></a>
        <a href="./docs.html">Docs</a>
        <a href="./checks.html">Checks</a>
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
    title: "Lint for Shelly",
    body: "66 checks catch Espruino, device, and firmware limits.",
  },
  {
    title: "Know what fits",
    body: "Track script bytes, JsVars, and live peak memory.",
  },
  {
    title: "Ship lean builds",
    body: "Compare debug, production, and advanced artifacts.",
  },
  {
    title: "Stay near hardware",
    body: "Deploy, stream logs, and probe real capabilities.",
  },
];

/**
 * The guided tour under the feature cards: one region of the real UI per row,
 * with the copy that says what it is for.
 *
 * `figs` names crops under `site/figures/`, cut out of the same two hero
 * screenshots by `scripts/crop-docs-figures.mjs` — so a tour image can never
 * drift from the hero above it, and refreshing both is one capture plus one
 * crop run. `-dark` suffix per theme, for the reason `HeroShot` explains.
 *
 * A row may carry more than one crop; they sit side by side at natural size,
 * which is how the portrait inspector column is shown without a row that is
 * three lines of copy next to 738 px of image.
 */
const TOUR: { key: string; figs: { src: string; alt: string }[]; title: string; body: string }[] = [
  {
    key: "toolbar",
    title: "Your device, in the title bar",
    body: "Pick the device and the script slot, watch the run state, and build, deploy or probe from the same row. Multiple devices and slots switch here; digest auth is supported.",
    figs: [
      {
        src: "toolbar",
        alt: "shellint toolbar: device picker, script slot, run state, Save, Build + Check, Deploy and Probe",
      },
    ],
  },
  {
    key: "rail",
    title: "Three gates, always visible",
    body: "Built, checked and probed — the rail says which of the three is stale before you deploy something you have not re-checked. 66/66 means every rule ran, not that every rule passed silently.",
    figs: [{ src: "rail", alt: "Readiness rail showing not built, checked 66/66 and probed" }],
  },
  {
    key: "artifacts",
    title: "Read what actually ships",
    body: "Every built artifact previews read-only in the editor — the DCE output, the minified output, and a unified debug ↔ prod diff that shows exactly what the environment gating removed.",
    figs: [
      {
        src: "artifacts",
        alt: "Artifact chip strip: source, debug.raw, debug.min, prod.raw, prod.min, diff",
      },
    ],
  },
  {
    key: "inspector",
    title: "Bytes and RAM before the flash",
    body: "Artifact sizes against the device caps, script counters that highlight their own lines in the editor, firmware limits on registrations and strings, the minimum firmware your API use needs, and a static RAM estimate drawn against the device's measured peak.",
    figs: [
      {
        src: "inspector-sizes",
        alt: "Inspector: artifact sizes for every build, and script counters for api calls, vars, functions and strings",
      },
      {
        src: "inspector-memory",
        alt: "Inspector: caps used against their limits, the RAM estimate by bucket, and estimate versus device peak",
      },
    ],
  },
  {
    key: "dock",
    title: "The device, while you work",
    body: "Script memory and CPU, RAM, filesystem, temperature and RSSI, an eco toggle, and a streamed debug log. Numeric series chart themselves from print(\"#m <series> <value>\").",
    figs: [
      {
        src: "dock",
        alt: "Device dock: firmware, run state, memory, cpu, ram, filesystem, temperature and signal readouts",
      },
    ],
  },
];

const SIGNALS = [
  ["66", "checks"],
  ["6", "artifacts"],
  ["104", "probes"],
];

/**
 * #site itself is the mount point declared in index.html; this component
 * fills it (a fragment, not a wrapping div) so the root's id stays unique.
 */
export function Landing() {
  const [theme, toggle] = useTheme();
  return (
    <Fragment>
      <SiteHeader theme={theme} toggle={toggle} />

      <main class="site-main">
        <section class="hero">
          <div class="hero-copy">
            <p class="hero-kicker">Shelly Gen2+ · TypeScript · Espruino</p>
            <h1>Write smarter scripts. Keep them small.</h1>
            <p class="hero-sub">
              Type safety, device-aware linting, size budgets, and deployment.
              One local workspace.
            </p>
            <div class="hero-cta">
              <a class="site-btn site-btn-primary" id="ctaDemo" href="./demo/">
                Open browser demo <span aria-hidden="true">→</span>
              </a>
              <a class="site-btn" id="ctaDownload" href="./download.html">
                Download
              </a>
            </div>
            <dl class="hero-signals" aria-label="shellint capabilities">
              {SIGNALS.map(([value, label]) => (
                <div key={label}>
                  <dt>{value}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </div>
          <HeroShot theme={theme} />
        </section>

        <section class="features">
          {FEATURES.map((f, index) => (
            <article class="feature" key={f.title}>
              <span class="feature-index" aria-hidden="true">0{index + 1}</span>
              <h2>{f.title}</h2>
              <p>{f.body}</p>
            </article>
          ))}
        </section>

        <section class="tour" aria-labelledby="tourTitle">
          <header class="tour-heading">
            <p class="tour-kicker">Inside shellint</p>
            <h2 id="tourTitle">One workspace. Every signal.</h2>
            <p>
              Follow script from source to device. Each surface answers one
              practical question before code ships.
            </p>
          </header>
          <article class="probe-spotlight" aria-labelledby="probeTitle">
            <div class="probe-copy">
              <p class="probe-eyebrow">● Device truth</p>
              <h3 id="probeTitle">Probe firmware. Remove guesswork.</h3>
              <p>
                Shellint checks 104 runtime capabilities. Each probe runs
                on-device. Results stay device and firmware specific. Generated
                typings expose supported APIs. Lint flags confirmed missing APIs.
              </p>
            </div>
            <div class="probe-flow" aria-label="Probe workflow">
              <div class="probe-node">
                <span>01</span>
                <strong>Shelly device</strong>
                <small>model + firmware</small>
              </div>
              <span class="probe-arrow" aria-hidden="true">→</span>
              <div class="probe-node probe-node-active">
                <span>02</span>
                <strong>Script.Eval</strong>
                <small>104 live checks</small>
              </div>
              <span class="probe-arrow" aria-hidden="true">→</span>
              <div class="probe-node">
                <span>03</span>
                <strong>Safer code</strong>
                <small>types + lint</small>
              </div>
              <p class="probe-note">
                Missing APIs become lint findings. Problems surface before deployment.
              </p>
            </div>
          </article>
          {TOUR.map((t, index) => (
            <article class="tour-row" key={t.key}>
              <div class="tour-copy">
                <span class="tour-index" aria-hidden="true">0{index + 1}</span>
                <div>
                  <h3>{t.title}</h3>
                  <p>{t.body}</p>
                </div>
              </div>
              <div class="tour-shots">
                {t.figs.map((f) => (
                  <div class="tour-shot" key={f.src}>
                    <img
                      src={`./figures/${f.src}${theme === "dark" ? "-dark" : ""}.png`}
                      alt={f.alt}
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>

        <section class="limits">
          <Group title="What the demo cannot do" id="limits">
            <p>
              Browser demo works offline. Device-only checks, deploys, and logs
              need <a href="./download.html">local version</a>.
            </p>
          </Group>
        </section>
      </main>

      <SiteFooter />
    </Fragment>
  );
}
