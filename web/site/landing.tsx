/*
 * Landing page (`site/index.html`, M26 plan §6.1) — front door for a visitor
 * who has never seen shellint: the size and lint story, plus two ways in (the
 * in-browser demo or the executable). Shares tokens.css and the app's
 * Button/theme so the site reads as the same product, not a marketing skin.
 *
 * `SiteHeader`/`SiteFooter` are exported for `download.tsx`. They live here
 * rather than in a third file because the build contract (M26 plan §5) names
 * exactly the files under web/site/, and neither page owns the other.
 */
import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "../ui/button";
import { Group } from "../ui/measure";
import { useTheme, type Theme } from "../shell/theme";
import { repoUrl } from "./release";
// Zero-import data module (see web/site/probe.tsx). The count is read from the
// catalog, so the landing, the spotlight and probe.html cannot disagree.
import { PROBES } from "../../server/probe/probe-catalog.ts";

/**
 * `true` when the visitor has asked their OS for less motion. Read once on
 * mount rather than at module scope so the check never runs during the
 * server-less first render, and subscribed to so flipping the OS setting takes
 * effect without a reload.
 *
 * `autoplay` is a static attribute — there is no CSS route to "do not autoplay"
 * — so this has to be JS, and it is the one thing standing between a
 * motion-sensitive visitor and an unstoppable looping video above the fold.
 */
function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

/**
 * The hero: the 45 s product video (`mise run capture:anim`), with one of its
 * own frames as the poster.
 *
 * `shellint-anim.*` (M41). Both earlier cuts — `shellint-tour.*` (M40) and
 * `shellint-demo.*` (M39) — are still tracked in `.github/assets/` and are no
 * longer referenced or shipped. Unlike those two, this one is not a screencast
 * of the app at all: it is an authored composition (a React/SVG drawing of the
 * shell, ten scenes, shot frame-by-frame from
 * `e2e/capture/assets/shellint-anim.html`), which is why its motion is exact
 * and its pacing does not depend on the capture machine.
 *
 * **Dark in both themes, deliberately** (M38 plan §1, M39 unchanged). One cut is
 * rendered, in the dark theme, and it plays inside `.hero-window`. The poster is
 * dark for the same reason: a light poster that jumps to a dark first frame is
 * worse than a consistently dark window. `shellint-header{,-dark}.png` stay
 * tracked and shipped — they are the README hero and the source of every
 * `figures/*.png` crop below.
 *
 * **No `.hero-window-bar`, and no crop.** Both were right when this was a raw
 * 1620×908 screencast of the app: the bar supplied the window the footage did
 * not have, and the `1620 / 660` box cropped a third of the frame away to put
 * the dashboard rail high. The video is now a composed 16:9 frame that draws its
 * own window chrome and captions its own beats (see the scene list inside
 * `e2e/capture/assets/shellint-anim.html`), so a second title bar reads as a
 * mistake and a crop cuts the composition in half. `.hero-window` is kept for
 * its border and shadow.
 *
 * `muted` + `playsInline` are what make autoplay legal on iOS and in Chrome.
 * Under reduced motion nothing autoplays: the poster shows with controls and
 * the visitor presses play.
 *
 * **mp4 first, webm second** — the opposite of the usual order, and measured
 * rather than assumed. On this content (UI motion over hard-edged text) VP9
 * buys nothing worth reordering for, where the usual advice assumes a
 * comfortable webm win. So the order is decided by compatibility instead, and
 * the webm stays as the codec fallback for a browser that cannot decode
 * High-profile H.264. See `scripts/render-anim-video.mjs` for the numbers.
 */
const HERO_LABEL =
  "shellint: device picker, build and check, artifact preview, size and RAM inspector, device dock";

/**
 * The two `<source>` elements, in one place: the inline hero and the lightbox
 * play the same two files, and the mp4-before-webm order below is load-bearing
 * (see `HeroShot`), so it must not be able to differ between them.
 */
function HeroSources() {
  return (
    <Fragment>
      <source src="./shellint-anim.mp4" type="video/mp4" />
      <source src="./shellint-anim.webm" type="video/webm" />
    </Fragment>
  );
}

/**
 * Move a video's playhead, waiting for metadata when it has none yet.
 *
 * The lightbox's `<video>` only starts loading when the dialog first opens, and
 * a `currentTime` write before `loadedmetadata` is silently clamped to ~0 —
 * which looked exactly like the handover not being wired at all.
 */
function seekTo(video: HTMLVideoElement, at: number) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    video.currentTime = at;
    return;
  }
  video.addEventListener("loadedmetadata", () => { video.currentTime = at; }, { once: true });
}

function HeroShot() {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const inlineRef = useRef<HTMLVideoElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bigRef = useRef<HTMLVideoElement>(null);

  // The dialog is driven by `open`, the same shape the app's modals use
  // (web/diff/diff-modal.tsx): `showModal()` is what puts it in the top layer
  // and gives Esc and the `::backdrop` for free.
  //
  // The two videos are two elements over the same two URLs — the second plays
  // out of the HTTP cache, not a second download — so the playhead is handed
  // across on open and back on close. Without that, expanding a video 30 s in
  // restarts it from the title card, which reads as a different video.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      dialog.close();
      return;
    }
    dialog.showModal();
    const big = bigRef.current;
    if (big) {
      seekTo(big, inlineRef.current?.currentTime ?? 0);
      if (!reduceMotion) void big.play();
    }
    inlineRef.current?.pause();
  }, [open, reduceMotion]);

  // Also the `onClose` handler, so Esc and the browser's own dismissal take
  // the same path as the close button rather than stranding the inline video
  // paused on whatever frame it was expanded from.
  const close = () => {
    const at = bigRef.current?.currentTime;
    setOpen(false);
    const inline = inlineRef.current;
    if (!inline) return;
    if (at != null) seekTo(inline, at);
    if (!reduceMotion) void inline.play();
  };

  return (
    <div class="hero-window">
      <div class="hero-shot">
        <video
          ref={inlineRef}
          id="heroVideo"
          class="hero-video"
          poster="./shellint-anim-poster.png"
          width={1920}
          height={1080}
          autoPlay={!reduceMotion}
          controls={reduceMotion}
          muted
          loop
          playsInline
          aria-label={HERO_LABEL}
          // Only when it has no controls of its own: under reduced motion the
          // native control bar is the video's click target, and stealing those
          // clicks would take play/pause away from the one visitor who needs
          // them most.
          onClick={reduceMotion ? undefined : () => setOpen(true)}
        >
          <HeroSources />
        </video>
        <Button
          class="hero-expand"
          id="heroExpand"
          onClick={() => setOpen(true)}
          aria-label="Play the product video full size"
        >
          <span aria-hidden="true">⤢</span> expand
        </Button>
      </div>
      <dialog
        ref={dialogRef}
        id="heroLightbox"
        class="hero-lightbox"
        onClose={close}
        onClick={(e) => {
          // The dialog element itself is the backdrop's hit target; the video
          // inside it is not, so this closes on a click outside the frame
          // without swallowing clicks on the controls.
          if (e.target === dialogRef.current) close();
        }}
      >
        <video
          ref={bigRef}
          id="heroLightboxVideo"
          poster="./shellint-anim-poster.png"
          width={1920}
          height={1080}
          controls
          muted
          loop
          playsInline
          aria-label={HERO_LABEL}
        >
          <HeroSources />
        </video>
        <Button class="hero-lightbox-close" id="heroLightboxClose" onClick={close} aria-label="Close the video">
          <span aria-hidden="true">✕</span>
        </Button>
      </dialog>
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
        <a href="./faq.html">FAQ</a>
        <a href="./download.html">Download</a>
        <a href={repoUrl()} target="_blank" rel="noreferrer" aria-label="GitHub (opens in new tab)">
          GitHub <span class="external-link-icon" aria-hidden="true">↗</span>
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
      {/* No licence claimed on purpose: the repo carries no LICENSE file and
          no `license` field in package.json, so stating one would be a claim
          the project has not made. Add the line back once a licence lands. */}
      <span>A local playground for Shelly Gen2 scripts.</span>
      <a href="./stack.html">Built with</a>
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
 * The guided tour under the feature cards: one region of the real UI per row.
 *
 * `figs` names crops under `site/figures/`, cut from the same two hero shots
 * by `scripts/crop-docs-figures.mjs`, so a tour image cannot drift from the
 * hero above it; refreshing both is one capture plus one crop run. `-dark`
 * suffix per theme: unlike the hero video, these sit on the page itself, and a
 * light crop on a dark page reads as some *other* program. Driven off
 * `useTheme()`, not a `<picture>` with `prefers-color-scheme`, which only sees
 * the OS preference and would ignore the header toggle.
 *
 * A row may carry more than one crop; they sit side by side at natural size —
 * how the portrait inspector column fits next to three lines of copy.
 */
const TOUR: { key: string; figs: { src: string; alt: string }[]; title: string; body: string }[] = [
  {
    key: "toolbar",
    title: "Your device, in the title bar",
    body: "Pick device and slot, watch the run state, and build, deploy or probe from one row. Digest auth is supported.",
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
    body: "Built, checked and probed. The rail says which one is stale before you deploy. 66/66 means every rule ran — not that every rule passed silently.",
    figs: [{ src: "rail", alt: "Readiness rail showing not built, checked 66/66 and probed" }],
  },
  {
    key: "artifacts",
    title: "Read what actually ships",
    body: "Every artifact previews read-only in the editor: DCE output, minified output, and a debug ↔ prod diff showing what the environment gating removed.",
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
    body: "Artifact sizes against device caps, counters that highlight their own lines, firmware limits on registrations and strings, the minimum firmware your APIs need, and a RAM estimate against the measured peak.",
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
    body: "Script memory and CPU, RAM, filesystem, temperature and RSSI, an eco toggle, and a streamed debug log. print(\"#m <series> <value>\") charts itself.",
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
  [String(PROBES.length), "probes"],
];

/**
 * #site is the mount point in index.html; this fills it with a fragment, not a
 * wrapping div, so the root's id stays unique.
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
              Types, device-aware lint, size budgets and deploy. One local
              workspace.
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
          <HeroShot />
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
            <h2 id="tourTitle">One workspace.</h2>
            <p>
              Source to device. Each surface answers one question before the
              code ships.
            </p>
          </header>
          <article class="probe-spotlight" aria-labelledby="probeTitle">
            <div class="probe-copy">
              <p class="probe-eyebrow">● Device truth</p>
              <h3 id="probeTitle">Probe firmware. Remove guesswork.</h3>
              <p>
                {PROBES.length} capability checks, run on the device itself.
                Results are device- and firmware-specific: typings expose what
                exists, lint flags what does not.
              </p>
              <a class="probe-cta" id="ctaProbe" href="./probe.html">
                How the probe works <span aria-hidden="true">→</span>
              </a>
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
                <small>{PROBES.length} live checks</small>
              </div>
              <span class="probe-arrow" aria-hidden="true">→</span>
              <div class="probe-node">
                <span>03</span>
                <strong>Safer code</strong>
                <small>types + lint</small>
              </div>
              <p class="probe-note">
                Missing APIs become lint findings, before you deploy.
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
              The browser demo works offline. Device checks, deploys and logs
              need the <a href="./download.html">local build</a>.
            </p>
          </Group>
        </section>
      </main>

      <SiteFooter />
    </Fragment>
  );
}
