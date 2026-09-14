# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

Read alongside: [`README.md`](./README.md) (what it is, how to run it),
[`CONTRIBUTING.md`](./.github/CONTRIBUTING.md) (the gate and the rules it enforces).
This file is the architecture map — keep it accurate when you change what it
describes.

## What this project is

**shellint** — a local development playground for authoring
[Shelly Gen2 device scripts](https://shelly-api-docs.shelly.cloud/gen2/Scripts/Overview):
a Node server hosting a browser code editor, TypeScript authoring with device-aware
type safety, a five-tier lint engine encoding Espruino/Shelly constraints, a
size/memory dashboard, live device telemetry, and build-time feature gating via
`meta.env.debug` / `meta.env.prod`.

### Domain constraints that drive every design decision

- Shelly Gen2 scripts run on **Espruino on an ESP32** — not Node, not a browser.
  The [Language Reference](https://shelly-api-docs.shelly.cloud/gen2/Scripts/LanguageReference)
  is the authority on what is legal, not general JS knowledge. Consult the live
  docs (README link list, or the `find-docs` skill) before touching the device
  API surface or the language subset; the API has a
  [changelog](https://shelly-api-docs.shelly.cloud/gen2/changelog).
- **Memory is the binding constraint.** Script size and RAM are first-class
  product metrics — hence the dashboard and the minification tiers.
- Device APIs are namespaced globals (`Shelly.*`, `Timer.*`, HTTPServer, RPC
  handlers, AES, virtual components).

## Commands

Prefer **mise** tasks ([`mise.toml`](./mise.toml)); `mise tasks` lists them all.
Every `mise run X` has an equivalent `npm run X`.

```bash
mise run install          # npm install
mise run beforeCommit     # the gate (alias: b) — must be green before committing
mise run start            # server (alias: dev)
mise run build            # oxlint + device artifacts + web bundle
mise run test             # DCE/minify asserts + web + server smoke
                          # takes a name filter, and --isolated for process-per-test
mise run typecheck        # device fixture + server + web (parallel — the npm
                          # script fans out through scripts/typecheck-all.mjs)
mise run check:lines      # ≤500 raw lines per source file
mise run build:static     # site/ for GitHub Pages
mise run probe / profile  # capability probe / device profile (needs a device)
mise run typecheck:script # your live scripts/main.ts — deliberately outside the gate
```

txiki variants (`build:txiki`, `start:txiki`, `test:txiki`, `test:e2e:txiki`,
`vendor:txiki`) mirror the Node ones — see the runtime section below.

Build config: `config/tsconfig.shelly.base.json` (device compiler options; extended by
`config/tsconfig.shelly.script.json` for `scripts/main.ts` and
`config/tsconfig.shelly.fixture.json` for the gate's fixture) / `config/tsconfig.server.json` /
`config/tsconfig.web.json`. Entry `scripts/main.ts`, pipeline `scripts/build-shelly.mjs`.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node 24 by default; txiki.js v26.6.0 as a second runtime behind conditional adapters |
| Device compile | `tsc` → ES5, `module: none`, `noEmitHelpers`, `noLib` + `types: []` |
| Types | `types/shelly.d.ts`, `types/espruino-lib.d.ts`, `types/meta.d.ts` — the entire stdlib for device code, since `noLib` drops `lib.es*` |
| Env gating | `meta.env` DCE → `*.raw.js`; Terser → `*.js`; prod also shortens log strings into `dist/prod.logmap.json`, which the logs panel re-expands |
| Emit | Flat (no IIFE) → `dist/{debug,prod}.{raw.js,js,adv.js}`; `*.adv.js` is tier 3 (`espruino --minify`, chained after Terser) and is simply absent when that binary is not installed |
| Server / UI | Hand-rolled router + CodeMirror 6. **No web framework** — `server/core/router.ts` (patterns, specificity precedence, dispatch) + `server/core/context.ts` (`c.json`/`c.text`/`c.html`/`c.body`, `c.req.*`); `server/core/node-server.ts` adapts `node:http` → `fetch`, txiki uses `tjs.serve({ fetch })`. Route modules take a `Router`; unmatched path *or method* is `404`, never 405 |
| Web bundle | esbuild → `web/dist/{app.js,styles.css,api-docs.json}`, minified and precompressed to `.br`/`.gz`; `server/core/static-assets.ts` negotiates on `Accept-Encoding`. Sourcemap dev-only. `web/editor/cm-setup.ts` replaces CodeMirror's `basicSetup` to keep `@codemirror/lint` out. Budgets enforced by `scripts/test-web-assets.mjs` |
| Config | `shellint.json` (`host`, `port`, `compiler`, `minify`); legacy `devroom.json` is fallback only. Default compiler is clean-room shellint (`"shellint"`; legacy `"devroom"` accepted); anything else prints `shelly-forge path not wired yet` |
| Multi-device | `.shellint/devices.json` (gitignored, `0600`) holds the device list and active `{device, slot, script}` — `server/device/devices.ts`. Digest auth retries a 401 challenge once. Header pickers switch via `POST /api/session/active`, re-mirroring the device profile/probe into fixed `types/*` paths |
| Deploy | WS PutCode; mode debug/prod + artifact min/raw |
| Compliance | `POST /api/check` — source lint Tier 1–5 + post-compile dialect guard. `server/lint/check-catalog.ts` names all 66 checks, including `syntax-error` and `type-error` (`server/lint/lint-types.ts`), so a script that does not parse or type-check reports in the check pane and gutter instead of passing over a recovered AST. A parse failure marks every other rule `skipped`; each run reports pass/warn/fail/**skipped** per rule. `GET /api/checks` serves the catalog alone |
| Project-source lint | `mise run oxlint` → [oxlint](https://oxc.rs) (pinned exact) over `server/ web/ scripts/ shared/ e2e/`, `correctness` + `suspicious` as errors plus `complexity` max 20, config in [`.oxlintrc.json`](./.oxlintrc.json). Hygiene lint of the *tool's own* source — unrelated to device checks, and never run on device code |
| Cyclomatic complexity | `complexity: ["error", { "max": 20 }]`, `variant: classic` — named explicitly because it sits in oxlint's `restriction` category. Breaches are split or turned into dispatch tables: `server/lint/{dialect-check,lint-source}.ts` (**table order is finding order**, compared by the artifact tests), `server/script/script-stats.ts`, `web/static/local-api.ts`, `web/device/status-metrics.ts`. No suppressions |
| Line limit | `mise run check:lines` → [`scripts/check-line-limit.mjs`](./scripts/check-line-limit.mjs), the single authority: ≤500 raw lines over `.ts .tsx .mts .mjs .js` **and** `.css`, minus its skip list (build output, `vendor/`, `.tmp/`, `bench/`, `.claude/`, `types/generated*`, `scripts/main.ts`) plus two **root-only** entries, `site/` and `design/`. Root-anchoring those two matters: matching `site` at any depth had silently exempted `web/site/` — the whole presentation site — along with the intended build output |
| Dashboard | `/api/stats` → `estimate` (JsVar model) + `minFirmware`; size sparkline; estimate vs live `mem_peak`. Counter badges carry `stats.sites` and toggle a line highlight in the editor |
| Live telemetry | `GET /api/device/status` + eco toggle; polling, eco and reboot live in `web/device/use-device-status.ts` so the dock header keeps them while tiles are unmounted |
| RPC channels | `/rpc` uses two inferred global permits, per-device exclusive leases and 30 s idle reuse; documented six applies to non-persistent channels, while `/debug/log` has its separate documented three-socket limit |
| Debug logs | `GET`/`POST /api/device/logs` — the server holds the one `/debug/log` socket, the browser polls; `print("#m <series> <value>")` charts numerically |
| Charts / diff | Hand-rolled inline SVG (`web/charts/spark.ts`) and hand-rolled LCS diff (`web/diff/diff.ts`) — deliberately dependency-free |
| Artifact preview | Chip strip above the editor swaps in any built `dist` artifact read-only; `GET /api/artifacts` + `/api/artifact` serve a six-name allowlist. Last entry is `diff · debug ↔ prod (raw)` |
| Device profile | `types/device-profile.json` (`ListMethods` + components + gen/fw) drives Tier 4. Authoritative per-device copy at `.shellint/devices/<id>/profile.json`, mirrored for the active device |
| Capability probe | `mise run probe` → 116 `Script.Eval` expressions (`server/probe/probe-catalog.ts`) → `types/generated-probe.json` → `types/generated.d.ts`. Excluded from the device compile; absences surface as `probe-absent-api`. Severity follows provenance: **error** from the active device, **warn** otherwise |
| Static build | `mise run build:static` → `site/`: no server, no device, works offline. `scripts/static-esbuild.mjs` swaps `web/lib/api.ts` for `web/static/local-api.ts`, a fake router over the same route strings, so no component changed. Build/check/stats run in `web/static/pipeline.worker.ts` (`ts.transpileModule`, byte-identical to `tsc -p`, locked by `test-transpile-parity`, then the *same* `shared/device-pipeline.mjs` the server uses). `server/lint/check.ts` runs unmodified over an in-memory VFS; the 14 rules needing a profile/probe/`types.d.ts` report `skipped`, never a false `pass` |
| UI layout | `#app` grid: header 52 · readiness rail 38 · workspace 1fr · dock 46/300. Header = wordmark, device/slot chips, run-state chip, toolbar. Rail (`web/shell/readiness-rail.tsx`) states built/checked/probed gates and owns the one transient status line. Inspector is a tab strip (build/check/options, last tab in localStorage). Dock (`web/device/dock.tsx`) owns its own row and is splitter-resizable. Breakpoints 1000 / 1100 / 900px |
| Data display | One measure-row grammar (`web/ui/measure.tsx`) for sizes, caps and memory buckets, so bars compare down a column; colour only at ≥75% of a limit or on the artifact Deploy targets |
| Theme | Dark by default, light behind `prefers-color-scheme`, header toggle overrides (`web/shell/theme.ts` → `<html data-theme>` + localStorage). Tokens in `web/shell/tokens.css`; CodeMirror themed off the same custom properties in `web/editor/cm-theme.ts`. Elevation only on the shared modal frame |
| Auth | None for the shellint UI itself. Digest auth is supported *to the device*; `.shellint/devices.json` stores a plaintext password — LAN-only tool |

## Working rules

**Never make a gate step depend on `scripts/main.ts`.** It is the user's live
editor buffer — gitignored, seeded from `templates/main.example.ts`. Every gate
step compiles [`fixtures/device/main.ts`](./fixtures/device/main.ts) instead,
copied per runner into `.tmp/<name>/` by `scripts/fixture-workspace.mjs` and
pointed at through `SHELLINT_SCRIPT` / `SHELLINT_DIST` (honoured by
`server/core/paths.ts`, `scripts/build-shelly.mjs` and both Playwright configs,
which run their own servers on 8789 / 8797 and never reuse the dev server on
8787). The fixture must stay lint-clean on all five tiers (`test-smoke.mjs`
asserts it); changing it changes the e2e design baselines.

**Never point verification at a live device.** Differential runs and golden
captures go through the fixture workspace, not the device in
`.shellint/devices.json`. A deploy, `/api/device/eco`, `/api/device/script` or
`mise run probe` fired mid-capture writes to real hardware and can destroy a slot's
source irrecoverably. Separately, `types/device-profile.json` re-dirties with a
fresh `at` timestamp on any run made while a device answers — that dirt is
environmental, not a change to commit.

`scripts/test.mjs` runs the two builds in parallel, then **imports** each test
module into its own process rather than spawning `node --import tsx` per file
(~750 ms of startup each, most of the old runtime). `--isolated` restores
process-per-test, for failures that smell like cross-test module state.

## The txiki single-file executable

txiki.js is a second runtime; `tjs compile` produces one self-contained
executable per platform, asserted under 5 MB by `release.yml`.

- **One vendored `tjs` binary** (gitignored `vendor/txiki/`): the slim `min`
  profile — no FFI, no TLS, ~2.0 MB — from
  [`lukasMega/txiki.js-with-slim-builds`](https://github.com/lukasMega/txiki.js-with-slim-builds/releases/tag/slim-v26.6.0-8),
  because that binary is what `tjs compile` embeds. `scripts/vendor-txiki.mjs`
  fetches it by pinned tag + sha256 for darwin-arm64, linux-x64 and win32-x64
  (darwin-x64 has no slim asset). `SHELLINT_TJS_BIN` / `SHELLINT_TJS_VERSION`
  override the defaults; the version is asserted against `--version`.
- **Bundling uses the repo's own esbuild**, not `tjs bundle`:
  `__TJS_BUNDLER__` is compiled out of every slim profile, and upstream
  txiki v26.6.0 ships no Linux asset at all, so no released binary can bundle on
  Linux. Two flags `tjs bundle` supplied implicitly are explicit in
  `scripts/txiki-bundle.mjs`: `format: "esm"` (the `iife` default rejects the
  top-level `await` in `server/index.txiki.ts`) and `external: ["tjs:*"]`.
- **The executable is self-contained, and that is not free.**
  `server/core/paths.ts` resolves `ROOT` to `process.cwd()`, so a released binary
  would otherwise read `web/`, `templates/` and `types/` from whatever directory
  it was started in. `server/core/embedded-assets.ts` is the fix and is **empty
  on purpose** — the Node build must keep its filesystem path — while
  `scripts/build-txiki.mjs` generates a populated replacement that
  `scripts/txiki-bundle.mjs` swaps in by esbuild alias (not a `package.json`
  condition, which would point `typecheck:server` at a build output). Two halves:
  the four browser assets are embedded as bytes and served (brotli for the three
  big ones — raw does not fit under the size assert), and
  `templates/main.example.ts` plus the three `types/*.d.ts` are embedded as text
  and **materialised to disk on first run**, never overwriting. The device
  compile is `noLib`/`types: []`, so those declarations are its entire stdlib and
  `/api/build` cannot work without them. **A new file the binary reads at runtime
  must be added to one of those two lists.**
- npm install, TypeScript and Playwright stay on Node.

## CI and release

`.github/workflows/ci.yml` runs the one gate command on `ubuntu-latest` and
`macos-latest`, provisioning `tjs` through `.github/actions/setup-tjs` (a thin
wrapper over `scripts/vendor-txiki.mjs`, so CI and a laptop share one pinned
path), installing `chromium-headless-shell` rather than full `chromium` (the
suite never launches a headed browser) and setting `PW_CHANNEL=bundled`.
`e2e/helpers/browser-channel.ts` picks the bundled headless shell whenever it is
found in Playwright's browser registry and falls back to *system* Chrome
otherwise, so a checkout that cannot reach Google's CDN still runs the gate;
CI has no Chrome, hence the explicit opt-in. Both engines satisfy the committed
baselines. Design baselines exist twice,
`-chromium-darwin` and `-chromium-linux`; both are committed and a deliberate
design change has to refresh both.

The README/landing hero pair (`.github/assets/shellint-header{,-dark}.png`) is
shot by `mise run capture:header` → `e2e/capture/header.spec.ts` on
`e2e/playwright.capture.config.ts` (same server and mocks as the gate config it
extends; the gate config `testIgnore`s `capture/**` because a capture run
overwrites tracked images). Both shots come from one helper and differ only by
`shellint.theme` in localStorage — the earlier light shot was taken without the
`/api/stats` mock, so its sidebar read "no stats yet" against a fully populated
dark one. Run with `PW_CHANNEL=bundled`, like the baselines. Both specs under
`capture/` share that helper, `e2e/helpers/settled-app.ts`, and the two capture
npm scripts each name their spec (`… capture.config.ts header` / `… demo`), so
one capture never re-writes the other's tracked media.

The landing hero's **product video** is `.github/assets/shellint-anim.{mp4,webm}`
plus `shellint-anim-poster.png`, and it is **not a screencast of the app**. The
source is `e2e/capture/assets/shellint-anim.html`: one self-contained authored
composition — a React/SVG drawing of the shell, ten named scenes over 45 s at
1920×1080, dark, with its own captions. `mise run capture:anim` runs the chain:

```
e2e/capture/anim.spec.ts     → .tmp/capture/anim/frames/*.png + meta.json
scripts/render-anim-video.mjs → the three tracked files, then the budget assert
```

Two properties follow from the source being a composition rather than footage,
and they are why this cut replaced the screencast:

- **The capture is deterministic.** The composition renders as a pure function
  of one authored clock and answers a synchronous seek
  (`data-om-seek-to-time-frame`, applied under `ReactDOM.flushSync`), so the
  spec seeks frame *n*, screenshots, and gets exactly that frame — 1350 of
  them, identical on any machine. The screencast below had to *derive* a
  playback rate because its pacing was whatever the capture machine managed.
- **Nothing is composed afterwards.** No Remotion, no titles, no beat table:
  `render-anim-video.mjs` is PNG sequence in, h264 + vp9 + a poster out. The
  poster is one of the captured frames copied byte-for-byte, so it cannot drift
  from what plays.

Two things bit once and are commented in the spec: the frames must be a
**viewport clip at whole pixels** (an element screenshot lands on the stage's
flex-centred box, whose fractional top rounds out to 1920×**1081**, and libx264
rejects an odd height outright), and the stage's fit `transform` has to be
cleared — otherwise the capture is the scaled-to-viewport size, not the
authored one. It gets its own Playwright config
(`e2e/playwright.anim.config.ts`) because the subject is a `file://` page: the
two servers the base config starts, `build:static` among them, are minutes of
work this capture never touches.

On the landing page the hero plays inline (muted, looping, no controls) and
**expands into a `<dialog>` lightbox** — the expand chip, or a click anywhere on
the video when it has no controls of its own. The two `<video>` elements share
one `HeroSources`, and the playhead is handed across on open and back on close,
so expanding 30 s in does not restart the video. Two things this depends on: a
`currentTime` write before `loadedmetadata` is silently clamped to ~0 (hence
`seekTo`), and a host that answers `Range` requests — without a `206` Chrome
calls the media unseekable and every seek clamps, which is why
`scripts/preview-static.mjs` serves partial content. Pages already does.

`SITE_MEDIA_BUDGET` caps the mp4 the same way it capped the old one, asserted at
encode time and again by `test-static-bundle.mjs`; breach it by cutting a scene
out of the HTML, not by raising the CRF. Every re-encode adds its whole ~2.4 MB
to git history forever, so run it on deliberate UI changes only.

### The retired Remotion pipeline

Everything below is the **M40 tour** (`shellint-tour.*`), superseded by the cut
above and kept: still tracked in `.github/assets/`, still re-runnable through
`mise run capture:video`, referenced by nothing the site or the README ships.

It is two halves — footage shot by Playwright, cut by
[Remotion](https://www.remotion.dev) in `video/`. `mise run capture:video`
runs the whole chain:

```
e2e/capture/demo.spec.ts   → .tmp/capture/demo.webm  + demo.beats.json
scripts/normalize-capture.mjs → video/public/demo.source.mp4 + video/src/beats.generated.ts
scripts/render-remotion-video.mjs → the three tracked files, then the budget assert
```

The capture is **raw footage only**: no captions, no titles. Nine beats, cut
into six chapters, cursor via `page.screencast.showActions` (with `fontSize: 1`, the only
way to suppress the action *label* — it otherwise burns `Press
"ControlOrMeta+End"` into the corner of a marketing frame). Each beat still
**pushes in on the region it is about**, as a CSS transform on `#app`, so the
page re-renders at scale and zoomed text is genuinely sharper — doing that move
in Remotion instead would be an upscale of already-captured pixels. Three
consequences that each bit once and are commented in the spec: a push-in must
keep everything it clicks inside the frame, or Playwright waits on an off-screen
target until the spec times out; the transform has to be *removed* once a move
settles, or Playwright's stability check never passes on an element under it;
and anything portaled to `document.body` (`web/ui/option-tip.tsx`) sits outside
the transform, which is why the inspector beat parks the pointer instead of
hovering a counter.

Chapter order is `TOUR` order in `web/site/landing.tsx` **except chapter 03**,
the check engine, which has no `TOUR` row: the landing tour illustrates each row
with a crop of the hero screenshot, and the hero does not show the check pane.
That chapter pastes deliberately broken code (`BAD_CODE` in the capture spec —
eight findings across three tiers, every rule named in the comment above it) and
reads the findings pane. Three properties keep it honest and are easy to break:
the snippet **compiles**, so a parse failure does not mark the other 65 rules
`skipped`; the chapter is **three beats**, because the build wait and the
findings prose want different speeds, and the third (`checks-reset`, the undo
back to 66/66) is captured and never shown, existing only so chapters 04–06 are
not shot over a failing check; and `rule tiers` is `defaultCollapsed`, so
`#checkRules` does not exist until its group toggle is pressed.

The M39 five-chapter cut (`shellint-demo.*`) is still tracked in
`.github/assets/` and is deliberately neither referenced nor copied into
`site/` — superseded, kept, not shipped. `shellint-tour.*` now sits in exactly
the same position behind `shellint-anim.*`.

`video/` is **gitignored** — a local-only working directory, absent from a
clone, so `mise run capture:video` and the `video:*` tasks only run on a
checkout that still has it. That is the point of it being retired rather than
deleted: the M40 files it produced stay tracked, the machinery behind them does
not.

It is a **standalone pnpm root**, not a workspace member: Remotion plus its
headless Chrome is ~350 MB, `mise run video:install` is a separate task, and
`beforeCommit` must stay green on a machine where `video/node_modules` has never
existed. It is outside `oxlint`, outside `typecheck`, and root-anchored in
`check-line-limit.mjs`'s skip list. Two rules inside it are not obvious and are
in its README: no CSS `transition`/`animation` anywhere (Remotion renders frame
N by seeking, so a time-based CSS animation is frozen at frame 0 in the output
while moving fine in the studio preview — which is why the scaffold's Tailwind
wiring was removed), and `src/beats.generated.ts` is generated, never edited —
it is the only thing keeping a chapter's title over its own footage when the
capture is re-paced. Chapter 02 derives a `playbackRate` from a target length
rather than fixing one, because the beat contains a real build whose duration is
machine speed (18.8 s and 12.0 s on two consecutive captures).

That video is **dark-only and used under both site themes**, and its `poster` is
rendered from the same composition (`remotion still --frame=45`), so the still
cannot drift from what plays — the shipped cut keeps both properties.
`SITE_MEDIA_BUDGET` in `scripts/site-budgets.mjs` still guards
`render-remotion-video.mjs` at render time, but the `site/` assert now measures
`shellint-anim.mp4`, since that is the file the landing page loads. Every
re-render adds its whole ~3 MB to git history forever, so **run it with
`capture:header`, on deliberate UI changes only**.

The landing page's tour crops (`.github/assets/figures/*.png`) are **derived
from that pair**, not shot: `mise run capture:figures` →
`scripts/crop-docs-figures.mjs` cuts fixed rectangles out of the 1620×908 hero
with macOS `sips`, so a tour image can never drift from the hero above it and a
re-shoot is `capture:header` followed by `capture:figures`. Rectangles are named
in that script; `web/site/landing.tsx`'s `TOUR` names the files, and
`scripts/build-static.mjs` copies the whole directory, so adding a figure is a
crop entry plus a `TOUR` entry.

`release.yml` builds one executable per platform on a `v*` tag → **draft**
release, asserting each stays under 5 MB and boots. Assets ship as
`shellint-<platform>.zip` holding one file (`shellint`, `shellint.exe` on
Windows) — a bare binary served over HTTPS loses its exec bit in Safari. The
size assert and smoke run happen on the raw binary; zipping is the last step
before the checksum. Unix uses Info-ZIP `zip -X`, which stores the mode the
staged binary carries (`chmod 755` is explicit at stage time for exactly that
reason) and which `unzip`/Archive Utility/`ditto` restore — so the documented
quick start has no `chmod` step, and a round-trip assert in the workflow fails
the build if that ever stops being true. Windows' Git Bash has no `zip` and
falls back to 7-Zip (no exec bit to lose there), and the
checksum step must stay tool-agnostic (Git Bash has `sha256sum` and no `shasum`,
macOS the reverse). Asset names live in **two** places — the `release.yml` matrix
and `web/site/download.tsx`'s `PLATFORMS` — and must move together or the
download page 404s. `pages.yml` is gated on CI via `workflow_run`, so a red
`main` cannot publish.

Opt-in and outside the gate: `mise run test:e2e:lightpanda` runs the tests that
need neither layout nor screenshots against [Lightpanda](https://lightpanda.io)
(`test:e2e:hybrid` splits the suite across it and Chromium).
`scripts/install-lightpanda.mjs` pins one build by numeric GitHub asset id plus
sha256 — `nightly` is a rolling tag whose assets are replaced in place, and one
such swap already broke every `page.goto`. arm64 macOS and arm64/x64 Linux only.
