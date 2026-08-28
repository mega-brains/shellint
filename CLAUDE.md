# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ! IMPORTANT

`.claude/` is **gitignored** — the plans, findings and memory files below are
local working notes, present in the maintainer's checkout and absent from a
clone. Comments elsewhere in the repo that cite a plan path (`.claude/plans/…`)
are pointing at those notes, not at tracked documentation; this file is the
tracked summary.

- read [BASIC_INSTRUCTIONS](./.claude/memory/BASIC_INSTRUCTIONS.md)
- read [plans-file-header](./.claude/memory/plan-file-header-format.md)
- read [plans-in-project-dir](./.claude/memory/plans-in-project-dir.md)


## Status: M0–M4 basic · M5–M10 done (lint Tier 1–5, incl. connected Tier 4) · M11 type-layer bans · M12 dashboard metrics · post-M12 UI (editor sidebar, permanent check indicator) · M13 tier-3 minify, prod log map, 104-probe capability run, artifact preview · M14 web bundle size (minify, CSS bundle, precompressed assets) · M14b device-pipeline minify knobs + `bench/` corpus · M15 multi-device + multi-script slot selection (device CRUD, digest auth, header device/slot pickers, per-device profile/probe mirroring) · M17 static GitHub Pages build (`site/`, offline, device-less) · M18 UI redesign (dark/light tokens, readiness rail, inspector tabs, measure-row grammar, fixed dock, shared modal frame) · M21 Node + txiki dual-runtime server and CLI · M29 published at [mega-brains/shellint](https://github.com/mega-brains/shellint) (history rewritten, Pages live, CI green on both runners, `v0.0.1` released)

Prefer **mise** tasks ([`mise.toml`](./mise.toml)). Verify with `ls` / `mise tasks`
before assuming entrypoints exist.

Pre-commit gate: `mise run beforeCommit` (oxlint, line limit ≤500, typecheck
shelly/server/web, build, test, then the e2e suite twice — once against the Node
server, once against the txiki single-file executable,
`e2e/playwright.txiki.config.ts`, which runs it on port 8797 via `SHELLINT_PORT`
with one worker). The oxlint step lints **shellint's own source only** —
`server/`, `web/`, `scripts/`, `shared/`, `e2e/` — and **never Shelly device
code**, which has its own five-tier engine in `server/lint/`; see the
Project-source lint row below. It also caps cyclomatic complexity at 20;
`check:lines` is the one place the 500-line limit lives. `npm run beforeCommit`
is exactly equivalent — see the `vendor/` paragraph below for why that had to be
made true.

**CI (M27).** `.github/workflows/ci.yml` runs that same one command on
`ubuntu-latest` **and** `macos-latest`, provisioning `tjs` through
`.github/actions/setup-tjs` (a thin wrapper over `scripts/vendor-txiki.mjs`, so
CI and a laptop share one pinned path) and setting `PW_CHANNEL=bundled` — the
Playwright default is *system* Chrome, which no runner has, and the default must
stay that way because the `-darwin` design baselines were shot against it.
`release.yml` builds one executable per platform on a `v*` tag → **draft**
release, asserting each stays under 5 MB and boots. Assets ship as
`shellint-<platform>.zip` holding one file (`shellint`, `shellint.exe` on
Windows) — a bare binary served over HTTPS loses its exec bit in Safari and is
awkward on Windows; the size assert and standalone smoke run happen on the raw
binary, zipping is the last step before the checksum. Unix uses Info-ZIP `zip
-X` (the only one of the two that stores the exec bit), Windows' Git Bash has no
`zip` and falls back to the preinstalled 7-Zip. Asset names live in two places —
the `release.yml` matrix and `web/site/download.tsx`'s `PLATFORMS` — and must
move together or the download page 404s. `pages.yml` is gated on CI
via `workflow_run`, so a red `main` cannot publish. **Design baselines exist
twice** — `-chromium-darwin` (shot locally) and `-chromium-linux` (bootstrapped
2026-08-28 from the first CI run's `-actual` output, which is the only way to
get them). Both are committed and both legs are green. Every deliberate design
change has to refresh both — that dual refresh is the one recurring tax CI adds.

`release.yml`'s checksum step must stay tool-agnostic: Windows' Git Bash has
`sha256sum` and no `shasum`, macOS the reverse. It ran `shasum` alone once and
failed the whole Windows row *after* the binary had built, passed the 5 MB
assert and served a request.

**The single-file executable is self-contained, and that is not free.**
`server/core/paths.ts` resolves `ROOT` to `process.cwd()`, so a released binary
would otherwise read `web/`, `templates/` and `types/` out of whatever directory
it was started in — v0.0.2 shipped exactly that: it answered `/api/*` but gave
`web/index.html missing` (500) on `/`, and crashed with ENOENT at startup
anywhere without a `templates/`. `server/core/embedded-assets.ts` is the fix and
is **empty on purpose** — the Node build must keep its filesystem path — while
`scripts/build-txiki.mjs` generates a populated replacement that
`scripts/txiki-bundle.mjs` swaps in by esbuild alias (not a `package.json`
condition, which would point `typecheck:server` at a build output). Two halves:
the four browser assets are embedded as bytes and served (brotli for the three
big ones — raw is 715 KB against 736 KB of headroom under the 5 MB assert, so it
would not fit), and `templates/main.example.ts` plus the three `types/*.d.ts`
are embedded as text and **materialised to disk on first run**, never
overwriting. The device compile is `noLib`/`types: []`, so those declarations
are its entire stdlib and `/api/build` cannot work without them. Adding a file
the binary reads at runtime means adding it to one of those two lists.

Opt-in and deliberately outside that gate: `mise run test:e2e:lightpanda` runs
the 11 of 31 tests that need neither layout nor screenshots against
[Lightpanda](https://lightpanda.io) (`test:e2e:hybrid` splits the whole suite
across it and Chromium). `scripts/install-lightpanda.mjs` pins one build —
`1.0.0-nightly.8737+6acfc0357` — by numeric GitHub asset id plus sha256, because
`nightly` is a rolling tag whose assets are replaced in place and one such swap
already broke every `page.goto`; arm64 macOS and arm64/x64 Linux only.

**No gate step touches `scripts/main.ts`** — that file is the user's live
editor buffer, so its size, lint findings and even whether it compiles are
outside the repo's control. Every gate step instead compiles
[`fixtures/device/main.ts`](./fixtures/device/main.ts), copied per runner into
`.tmp/<name>/` by `scripts/fixture-workspace.mjs` and pointed at through
`SHELLINT_SCRIPT` / `SHELLINT_DIST` (honoured by `server/core/paths.ts`,
`scripts/build-shelly.mjs` and both Playwright configs, whose servers run on
their own ports — 8789 for Node, 8797 for txiki — and never reuse a dev server
on 8787, since that one serves the live script). `npm run typecheck:script`
(`mise run typecheck:script`) type-checks the live script on demand; `npm run
build:shelly` and the UI's Build button still build it as before. The fixture
must stay lint-clean on all five tiers — `test-smoke.mjs` asserts it — and
changing it changes the e2e design baselines.

**Verification never targets the live device** — differential and golden-capture
runs go through that same fixture workspace, never the device configured in
[`.shellint/devices.json`](./.shellint/devices.json). A deploy, `/api/device/eco`,
`/api/device/script` or `mise run probe` fired while recording a baseline writes
to real hardware: on 2026-08-20 an M22 Hono-removal capture overwrote slot 1 with
a 574-byte fixture build, turned eco mode on and started it — the slot's
3,623-byte source was unrecoverable. Separately,
[`types/device-profile.json`](./types/device-profile.json) re-dirties with a fresh
`at` timestamp on any gate run made while the device answers; a dirty `types/`
afterwards is environmental, not a change to commit.

`scripts/test.mjs` runs the two builds in parallel, then **imports** each test
module into its own process instead of spawning one `node --import tsx` per
file — that startup is ~750 ms each and was most of the suite's runtime.
`mise run test -- <name>` filters; `mise run test -- --isolated` restores
process-per-test, for when a failure smells like cross-test module state.

## Stack (committed)

| Layer | Choice |
|---|---|
| Runtime | Node 24 via mise by default; txiki.js v26.6.0 through conditional runtime and builder adapters. **One** `tjs` binary, vendored (gitignored `vendor/txiki/`): the slim `min` profile — no FFI, no TLS, ~2.0 MB — from the [`lukasMega/txiki.js-with-slim-builds`](https://github.com/lukasMega/txiki.js-with-slim-builds/releases/tag/slim-v26.6.0-8) release (tag `slim-v26.6.0-8`), not a locally built fork, because that binary is what `tjs compile` embeds in the shipped executable. It drops the `bundle`, `eval`, `serve`, `test` and `app` **subcommands** (the `tjs.serve` *API* is still there, which is all the capability probe needs). Bundling therefore does **not** use `tjs bundle` — see the Bundling row |
| Bundling (txiki) | `scripts/txiki-bundle.mjs` → the repo's own **esbuild** devDep, not `tjs bundle`. Forced, not preferred: `__TJS_BUNDLER__` is compiled out of *every* slim profile (tested — `slim-tls` and `slim-ffi-tls` reject `bundle` too, it is a switch independent of TLS) and upstream `saghul/txiki.js` v26.6.0 publishes **no Linux asset at all**, so no released txiki binary anywhere can bundle on Linux and CI could never run there. `tjs bundle` was only ever a wrapper that downloads esbuild into `~/.tjs/` and shells out. Equivalence measured 2026-08-25: identical 6.3 MB bundle, `tjs compile` output 4,506,842 B vs 4,506,881 B — **39 bytes** — and the executable boots and serves. Two flags `tjs bundle` supplied implicitly are now explicit: `format: "esm"` (default `iife` rejects the top-level `await` in `server/index.txiki.ts`) and `external: ["tjs:*"]` |
| Task runner | mise (`start`/`dev`, `build`, `oxlint`, `lint`, `test`, `beforeCommit`, `probe`, `clean`) |
| Device compile | `tsc` → ES5, `module: none`, `noEmitHelpers`, `noLib` + `types: []` |
| Env gating | `meta.env` DCE → `*.raw.js`; then Terser minify → `*.js`; prod also shortens log strings into `dist/prod.logmap.json`, which the logs panel re-expands (M13) |
| Emit | Flat (no IIFE) → `dist/{debug,prod}.{raw.js,js,adv.js}` — `*.adv.js` is tier 3 (`espruino --minify`, chained after Terser) and is simply absent when that binary is not installed (M13) |
| Types | `types/shelly.d.ts`, `types/espruino-lib.d.ts`, `types/meta.d.ts` — the whole stdlib for device code, since `noLib` drops `lib.es*` (M11) |
| Config | `shellint.json` (`host`, `port`, `compiler`, `minify`); legacy `devroom.json` is fallback only when shellint config is absent |
| Multi-device | `.shellint/devices.json` (gitignored, `0600`) holds device list and active `{device, slot, script}` selection — `server/device/devices.ts`. Digest auth retries a 401 challenge once. Header device/slot pickers switch via `POST /api/session/active`, re-mirroring selected device profile/probe into fixed `types/*` paths. |
| Server / UI | Hand-rolled router + CodeMirror 6. **No web framework** — `server/core/router.ts` (patterns, specificity precedence, dispatch) and `server/core/context.ts` (`c.json`/`c.text`/`c.html`/`c.body`, `c.req.*`) replaced Hono in M22; `server/core/node-server.ts` is the `node:http` → `fetch` adapter that replaced `@hono/node-server`, while txiki keeps using `tjs.serve({ fetch })`. Route modules take a `Router`; unmatched path *or method* is `404 Not Found`, never 405 |
| Web bundle | esbuild → `web/dist/{app.js,styles.css,api-docs.json}`, all minified and precompressed to `.br`/`.gz`; `server/core/static-assets.ts` negotiates on `Accept-Encoding`. Sourcemap is dev-only (`build:web:dev`); `npm run build:web` passes `--prod`. `web/editor/cm-setup.ts` replaces CodeMirror's `basicSetup` to keep `@codemirror/lint` out. Budgets enforced by `scripts/test-web-assets.mjs` (M14); the M18 redesign cut `styles.css` from 41.4 KB to ~35.4 KB and the budget with it |
| Deploy | WS PutCode; mode debug/prod + artifact min/raw |
| Static build | `mise run build:static` → `site/` for GitHub Pages: no server, no device, works offline. Same UI — `scripts/static-esbuild.mjs` swaps `web/lib/api.ts` for `web/static/local-api.ts`, a fake router over the same route strings, so no component changed. Build/check/stats run in `web/static/pipeline.worker.ts` (`ts.transpileModule` — byte-identical to `tsc -p`, locked by `test-transpile-parity` — then the *same* `shared/device-pipeline.mjs` the server uses). `server/lint/check.ts` runs unmodified over an in-memory VFS (`web/static/vfs.ts` + `node-shims/`); the 14 rules needing a device profile/probe/`types.d.ts` report `skipped`, never a false `pass`. Device UI gated off by `static: true` (`web/shell/device-section.tsx`) (M17) |
| Live telemetry | `GET /api/device/status` + eco toggle (M5); polling, eco and reboot live in `web/device/use-device-status.ts` so the dock header keeps them while the tiles are unmounted (M18) |
| Dashboard metrics | `/api/stats` → `estimate` (JsVar model) + `minFirmware`; size sparkline; estimate vs live `mem_peak` (M12). Counter badges carry `stats.sites` (source lines per counter) and toggle a line highlight in the editor when clicked |
| Debug logs | `GET`/`POST /api/device/logs` — server holds the one `/debug/log` socket, browser polls; `print("#m <series> <value>")` charts numerically (M12) |
| Charts | Hand-rolled inline SVG (`web/charts/spark.ts`). **No uPlot** — deliberately dependency-free |
| Compliance | `POST /api/check` — source lint Tier 1–5 + post-compile dialect guard (M8–M10). `server/lint/check-catalog.ts` names all 66 checks — including `syntax-error` and `type-error` (`server/lint/lint-types.ts`), so a script that does not parse or does not type-check reports in the check pane and on the editor gutter instead of passing over a recovered AST; a parse failure marks every other rule `skipped`; each run reports pass/warn/fail/**skipped** per rule, and `GET /api/checks` serves the catalog alone |
| Project-source lint | `mise run oxlint` → [oxlint](https://oxc.rs) 1.79.0 (pinned exact) over `server/ web/ scripts/ shared/ e2e/`, categories `correctness` + `suspicious` as errors plus `complexity` capped at 20, config in [`.oxlintrc.json`](./.oxlintrc.json). This is plain hygiene lint of the *tool's own* Node/browser TypeScript and is **not** related to the device checks: `scripts/main.ts`, `fixtures/`, `bench/`, `templates/`, `types/`, `web/static/vendor/` and every build output are in `ignorePatterns`, because device code is ES5/`noLib`/`types: []` Espruino and a general linter can only be wrong there. Six style-only rules are off with a reason each in the config; runs in ~60 ms, so it fronts both `build` and `beforeCommit` |
| Cyclomatic complexity | `complexity: ["error", { "max": 20 }]`, `variant: classic`. The rule sits in oxlint's `restriction` category, which is *not* enabled wholesale, so it is named explicitly. The ten functions that breached it were split by extraction or turned into dispatch tables — `server/lint/{dialect-check,lint-source}.ts` (one entry per banned construct, and **the table order is the finding order** the artifact tests compare), `server/script/script-stats.ts` (`CALL_COUNTERS`/`MARKED_CALLS`), `web/static/local-api.ts` (`ROUTES`, mirroring `server/core/router.ts`; `scripts/test-local-api.mjs` greps those keys) and `web/device/status-metrics.ts` (one builder per dock tile). No suppressions, no raised threshold |
| Line limit | `mise run check:lines` → [`scripts/check-line-limit.mjs`](./scripts/check-line-limit.mjs) is the **single** authority: ≤500 **raw** lines (blanks and comments count) over `.ts .tsx .mts .mjs .js` **and** `.css`, everywhere but its skip list — build output, `vendor/` (both the txiki binaries and `web/static/vendor/`), `.tmp/` fixture workspaces, `bench/`, `site/`, `design/`, `.claude/`, `types/generated*` and `scripts/main.ts`. oxlint's `max-lines` is deliberately left **off**: two overlapping half-checks would disagree, and this scan reaches `.css` and device code that oxlint ignores |
| UI layout | `#app` is a grid: header 52 · readiness rail 38 · workspace 1fr · dock 46/300 (M18). Header carries the wordmark, device/slot chips, run-state chip and the toolbar (Save · Build split · Deploy split · Probe, driven by `web/ui/button.tsx`). The rail (`web/shell/readiness-rail.tsx` + `readiness.ts`) states the built/checked/probed gates and owns the one transient status line. The inspector is a tab strip — build / check / options, one pane visible, last tab in localStorage (`web/shell/inspector.tsx`), resizable via the surviving vertical splitter. The dock (`web/device/dock.tsx`) owns its own row, so it cannot overlap the workspace; it is resizable by a horizontal splitter (`--dock-h` on `#app`, 140px min, 220px min workspace, height in localStorage). Breakpoints: 1000px moves the inspector above the editor; the header sheds the Deploy detail at 1100px and the device IP + run-state word at 900px (both stay in `title`), stepping down to a smaller, narrower face (`--sans-narrow`) as it goes |
| Data display | One measure-row grammar (`web/ui/measure.tsx`) for artifact sizes, caps and memory buckets, so bars compare down a column; colour only at ≥75% of a limit, or on the one artifact Deploy targets. Counters stay tiles; the estimate-vs-peak well is the only inset surface (M18) |
| Theme | Dark by default, light behind `prefers-color-scheme`, overridable by the header toggle (`web/shell/theme.ts` writes `<html data-theme>` + localStorage) — all tokens in `web/shell/tokens.css`. CodeMirror is themed in `web/editor/cm-theme.ts` off the same custom properties (its own DOM is not stylesheet-friendly). Elevation exists only on the shared modal frame (`web/ui/modal.css`) (M18) |
| Device profile | `types/device-profile.json` (`ListMethods` + components + gen/fw) drives Tier 4; refreshed when device answers. Authoritative per-device copy lives at `.shellint/devices/<id>/profile.json`; mirrored for active device. |
| Capability probe | `mise run probe` → 104 `Script.Eval` expressions (`server/probe/probe-catalog.ts`) → `types/generated-probe.json` → `types/generated.d.ts`. Excluded from the device compile; absences surface as `probe-absent-api` (M13). Severity follows provenance: **error** when the probe came from the *active* device (a ReferenceError on the box the next Deploy writes to), **warn** when it came from another device or none is active. Same per-device-copy-plus-mirror scheme as the device profile (M15) |
| Artifact preview | A chip strip above the editor (`source`, the built artifacts, and a `diff` dropdown) swaps in any built `dist` artifact read-only; `GET /api/artifacts` + `/api/artifact` serve a six-name allowlist (M13). Last entry is `diff · debug ↔ prod (raw)` — unified diff computed in browser (`web/diff/diff.ts`, hand-rolled LCS), tinted per +/- line |
| Auth | None for shellint UI itself. Digest auth is supported *to Shelly device* — `.shellint/devices.json` stores plaintext password, LAN-only tool. |

Default compiler is clean-room shellint (`compiler: "shellint"`; legacy `"devroom"` accepted). Setting
`compiler` to anything else prints `shelly-forge path not wired yet`.

## Commands

```bash
mise install
mise run install          # npm install
mise run build            # oxlint + Shelly dual artifacts + web bundle
mise run oxlint           # oxlint shellint's own source — never device code
mise run lint             # typecheck shelly + server + web (typecheck only, not oxlint)
mise run typecheck        # same as lint
mise run check:lines      # source files ≤ 500 raw lines (the authoritative check)
mise run test             # DCE/minify asserts + web + server smoke
                          # accepts a name filter and `--isolated` (see below)
mise run bench            # minify-option benchmark over bench/*.ts
mise run beforeCommit     # oxlint → check:lines → typecheck → build:gate → test → e2e (node + txiki exe)
mise run build:gate       # oxlint + fixture device build + web bundle (what the gate builds)
mise run typecheck:script # typecheck your live scripts/main.ts (outside the gate)
mise run start            # shellint server (alias: mise run dev)
mise run vendor:txiki     # fetch/verify the pinned vendor/txiki/tjs (--force, --check)
mise run build:txiki      # bundle txiki server and CLI entries
mise run start:txiki      # start the txiki server bundle
mise run test:txiki       # capabilities and Node/txiki HTTP parity
mise run test:e2e:txiki   # full e2e suite against .txiki/shellint
mise run deploy -- debug min   # MODE + MINIFY=min|raw
mise run deploy:txiki -- --mode debug --minify min
mise run probe
mise run probe:txiki
mise run profile # cache the device capability profile for Tier 4 lint
mise run profile:txiki
mise run clean
```

Also available via `npm run …` (`build:shelly`, `build:web`, `dev`, `beforeCommit`, …)
— and those spellings are **fully equivalent**: `scripts/txiki-test-util.mjs`
holds the `TJS_VERSION` pin and falls back to `vendor/txiki/tjs` on its own, so
nothing needs mise's `[env]` block. Until 2026-08-25 it did, and `npm run
beforeCommit` died in a fresh shell with `txiki.js executable missing`.
`vendor/` is gitignored, so a fresh clone (or anything that wipes `vendor/`) has
no `tjs` at all — that is what `scripts/vendor-txiki.mjs` fixes: one pinned tag
+ sha256 of the extracted binary, for darwin-arm64, linux-x64 and win32-x64.
**Only darwin-arm64 has ever been executed here**; the other two are
digest-verified but unrun, and the first CI run on each is what proves them.
darwin-x64 is absent because the slim release publishes no macOS x86_64 asset in
any profile. `build:txiki`, `build:txiki:executable` and `test:txiki` all depend
on it, and a re-run with the binary present spawns `--version` and touches no
network. `SHELLINT_TJS_BIN` overrides the vendored default (a repo-relative
value resolves against the repo root, so moving the checkout does not break it)
and `SHELLINT_TJS_VERSION` overrides the pin; both are conveniences, not
requirements. The version is asserted against `--version` for every bin used.
txiki needs bundles under `.txiki/`; npm installation, TypeScript, and
Playwright stay on Node.
Build config: `tsconfig.shelly.base.json` (device compiler options; extended by
`tsconfig.shelly.script.json` for `scripts/main.ts`, `tsconfig.shelly.fixture.json`
for the gate's fixture, and by the config `build-shelly.mjs` generates for a
`SHELLINT_SCRIPT` workspace) / `tsconfig.server.json` / `tsconfig.web.json`.
Entry: `scripts/main.ts`. Pipeline:
`scripts/build-shelly.mjs`.

## What this project is

**shellint** — local development playground for authoring
[Shelly Gen2 device scripts](https://shelly-api-docs.shelly.cloud/gen2/Scripts/Overview).

Planned shape (from `README.md`):

- Node.js server app hosting a browser code editor.
- Author Shelly scripts in **TypeScript** with type safety, compiled down to what the
  device runtime accepts.
- Custom **oxlint (or eslint) rules** encoding Shelly/Espruino-specific constraints.
- Dashboard: script size over time (raw / minified / advanced-minified), previous
  versions, counts of used Shelly APIs, variables, strings, `console.log`s, HTTP
  requests, debug logs; estimated memory footprint; live device data; whether the
  script is running on-device; ESP32 chip + memory info; Shelly Eco-mode toggle.
- Build-time feature gating via `meta.env.debug` / `meta.env.prod` — e.g. a production
  build with debug logs stripped and shortened log strings.

## Domain constraints that drive the design

These are why the project exists; they shape nearly every decision:

- Shelly Gen2 scripts run on **Espruino** on an ESP32, not Node and not a browser.
  It is a restricted JS dialect — treat the
  [Language Reference](https://shelly-api-docs.shelly.cloud/gen2/Scripts/LanguageReference)
  as the authority on what is legal, not general JS knowledge.
- **Memory is the binding constraint.** Script size and RAM use are first-class
  product metrics here (hence the size/memory dashboard and the minification tiers).
- Device APIs are namespaced globals (`Shelly.*`, `Timer.*`, HTTPServer, RPC handlers,
  AES, Virtual components) — see the API links in `README.md`.

Consult the live docs (the `README.md` link list, or the `find-docs` skill) before
writing anything that touches the device API surface or the language subset;
the Shelly API changes and has a
[changelog](https://shelly-api-docs.shelly.cloud/gen2/changelog).
