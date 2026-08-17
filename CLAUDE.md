# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ! IMPORTANT

- read [BASIC_INSTRUCTIONS](./.claude/memory/BASIC_INSTRUCTIONS.md)
- read [plans-file-header](./.claude/memory/plan-file-header-format.md)
- read [plans-in-project-dir](./.claude/memory/plans-in-project-dir.md)


## Status: M0–M4 basic · M5–M10 done (lint Tier 1–5, incl. connected Tier 4) · M11 type-layer bans · M12 dashboard metrics · post-M12 UI (editor sidebar, permanent check indicator) · M13 tier-3 minify, prod log map, 104-probe capability run, artifact preview · M14 web bundle size (minify, CSS bundle, precompressed assets) · M14b device-pipeline minify knobs + `bench/` corpus · M15 multi-device + multi-script slot selection (device CRUD, digest auth, header device/slot pickers, per-device profile/probe mirroring) · M17 static GitHub Pages build (`site/`, offline, device-less) · M18 UI redesign (dark/light tokens, readiness rail, inspector tabs, measure-row grammar, fixed dock, shared modal frame) · M21 Node + txiki dual-runtime server and CLI

Prefer **mise** tasks ([`mise.toml`](./mise.toml)). Verify with `ls` / `mise tasks`
before assuming entrypoints exist.

Pre-commit gate: `mise run beforeCommit` (line limit ≤500, typecheck shelly/server/web,
build, test, then the e2e suite twice — once against the Node server, once
against the txiki single-file executable, `e2e/playwright.txiki.config.ts`,
which runs it on port 8797 via `DEVROOM_PORT` with one worker).

`scripts/test.mjs` runs the two builds in parallel, then **imports** each test
module into its own process instead of spawning one `node --import tsx` per
file — that startup is ~750 ms each and was most of the suite's runtime.
`mise run test -- <name>` filters; `mise run test -- --isolated` restores
process-per-test, for when a failure smells like cross-test module state.

## Stack (committed)

| Layer | Choice |
|---|---|
| Runtime | Node 22 via mise by default; txiki.js v26.6.0 through conditional runtime and builder adapters |
| Task runner | mise (`start`/`dev`, `build`, `lint`, `test`, `beforeCommit`, `probe`, `clean`) |
| Device compile | `tsc` → ES5, `module: none`, `noEmitHelpers`, `noLib` + `types: []` |
| Env gating | `meta.env` DCE → `*.raw.js`; then Terser minify → `*.js`; prod also shortens log strings into `dist/prod.logmap.json`, which the logs panel re-expands (M13) |
| Emit | Flat (no IIFE) → `dist/{debug,prod}.{raw.js,js,adv.js}` — `*.adv.js` is tier 3 (`espruino --minify`, chained after Terser) and is simply absent when that binary is not installed (M13) |
| Types | `types/shelly.d.ts`, `types/espruino-lib.d.ts`, `types/meta.d.ts` — the whole stdlib for device code, since `noLib` drops `lib.es*` (M11) |
| Config | `devroom.json` (`host`, `port`, `compiler`, `minify`); legacy `deviceIp`/`scriptId` are read only as a one-time migration fallback (M15) |
| Multi-device | `.devroom/devices.json` (gitignored, `0600`) holds the device list + active `{device, slot, script}` selection — `server/device/devices.ts`. Digest auth (`server/device/auth-digest.ts`) retries a 401 challenge once. Header device/slot pickers (`web/device/device-select.tsx`, `web/device/slot-select.tsx`) switch via `POST /api/session/active`, which re-mirrors the switched-to device's cached profile/probe into the fixed `types/*` paths below and resets the log stream (a device with no cache of its own leaves the previous mirror standing rather than blanking it). The slot picker also creates/deletes slots and imports a slot's code into the editor as an unsaved buffer (`web/device/use-slot-import.tsx`). Per-script workspaces (`scriptKey`, always `"main"` today) are designed for but not built yet — see the M15 plan's §9 (M16) (M15) |
| Server / UI | Hono + CodeMirror 6 |
| Web bundle | esbuild → `web/dist/{app.js,styles.css,api-docs.json}`, all minified and precompressed to `.br`/`.gz`; `server/core/static-assets.ts` negotiates on `Accept-Encoding`. Sourcemap is dev-only (`build:web:dev`); `npm run build:web` passes `--prod`. `web/editor/cm-setup.ts` replaces CodeMirror's `basicSetup` to keep `@codemirror/lint` out. Budgets enforced by `scripts/test-web-assets.mjs` (M14); the M18 redesign cut `styles.css` from 41.4 KB to ~35.4 KB and the budget with it |
| Deploy | WS PutCode; mode debug/prod + artifact min/raw |
| Static build | `mise run build:static` → `site/` for GitHub Pages: no server, no device, works offline. Same UI — `scripts/static-esbuild.mjs` swaps `web/lib/api.ts` for `web/static/local-api.ts`, a fake router over the same route strings, so no component changed. Build/check/stats run in `web/static/pipeline.worker.ts` (`ts.transpileModule` — byte-identical to `tsc -p`, locked by `test-transpile-parity` — then the *same* `shared/device-pipeline.mjs` the server uses). `server/lint/check.ts` runs unmodified over an in-memory VFS (`web/static/vfs.ts` + `node-shims/`); the 14 rules needing a device profile/probe/`types.d.ts` report `skipped`, never a false `pass`. Device UI gated off by `static: true` (`web/shell/device-section.tsx`) (M17) |
| Live telemetry | `GET /api/device/status` + eco toggle (M5); polling, eco and reboot live in `web/device/use-device-status.ts` so the dock header keeps them while the tiles are unmounted (M18) |
| Dashboard metrics | `/api/stats` → `estimate` (JsVar model) + `minFirmware`; size sparkline; estimate vs live `mem_peak` (M12). Counter badges carry `stats.sites` (source lines per counter) and toggle a line highlight in the editor when clicked |
| Debug logs | `GET`/`POST /api/device/logs` — server holds the one `/debug/log` socket, browser polls; `print("#m <series> <value>")` charts numerically (M12) |
| Charts | Hand-rolled inline SVG (`web/charts/spark.ts`). **No uPlot** — deliberately dependency-free |
| Compliance | `POST /api/check` — source lint Tier 1–5 + post-compile dialect guard (M8–M10). `server/lint/check-catalog.ts` names all 66 checks — including `syntax-error` and `type-error` (`server/lint/lint-types.ts`), so a script that does not parse or does not type-check reports in the check pane and on the editor gutter instead of passing over a recovered AST; a parse failure marks every other rule `skipped`; each run reports pass/warn/fail/**skipped** per rule, and `GET /api/checks` serves the catalog alone |
| UI layout | `#app` is a grid: header 52 · readiness rail 38 · workspace 1fr · dock 46/300 (M18). Header carries the wordmark, device/slot chips, run-state chip and the toolbar (Save · Build split · Deploy split · Probe, driven by `web/ui/button.tsx`). The rail (`web/shell/readiness-rail.tsx` + `readiness.ts`) states the built/checked/probed gates and owns the one transient status line. The inspector is a tab strip — build / check / options, one pane visible, last tab in localStorage (`web/shell/inspector.tsx`), resizable via the surviving vertical splitter. The dock (`web/device/dock.tsx`) owns its own row, so it cannot overlap the workspace; it is resizable by a horizontal splitter (`--dock-h` on `#app`, 140px min, 220px min workspace, height in localStorage). Breakpoints: 1000px moves the inspector above the editor; the header sheds the Deploy detail at 1100px and the device IP + run-state word at 900px (both stay in `title`), stepping down to a smaller, narrower face (`--sans-narrow`) as it goes |
| Data display | One measure-row grammar (`web/ui/measure.tsx`) for artifact sizes, caps and memory buckets, so bars compare down a column; colour only at ≥75% of a limit, or on the one artifact Deploy targets. Counters stay tiles; the estimate-vs-peak well is the only inset surface (M18) |
| Theme | Dark by default, light behind `prefers-color-scheme`, overridable by the header toggle (`web/shell/theme.ts` writes `<html data-theme>` + localStorage) — all tokens in `web/shell/tokens.css`. CodeMirror is themed in `web/editor/cm-theme.ts` off the same custom properties (its own DOM is not stylesheet-friendly). Elevation exists only on the shared modal frame (`web/ui/modal.css`) (M18) |
| Device profile | `types/device-profile.json` (`ListMethods` + components + gen/fw) drives Tier 4; refreshed when the device answers. Authoritative per-device copy lives at `.devroom/devices/<id>/profile.json`; `types/device-profile.json` is a mirror of whichever device is active, rewritten on switch (M15) |
| Capability probe | `mise run probe` → 104 `Script.Eval` expressions (`server/probe/probe-catalog.ts`) → `types/generated-probe.json` → `types/generated.d.ts`. Excluded from the device compile; absences surface as `probe-absent-api` (M13). Severity follows provenance: **error** when the probe came from the *active* device (a ReferenceError on the box the next Deploy writes to), **warn** when it came from another device or none is active. Same per-device-copy-plus-mirror scheme as the device profile (M15) |
| Artifact preview | A chip strip above the editor (`source`, the built artifacts, and a `diff` dropdown) swaps in any built `dist` artifact read-only; `GET /api/artifacts` + `/api/artifact` serve a six-name allowlist (M13). Last entry is `diff · debug ↔ prod (raw)` — unified diff computed in browser (`web/diff/diff.ts`, hand-rolled LCS), tinted per +/- line |
| Auth | None for the DevRoom UI itself. Digest auth (username `admin`, per-device password) is supported *to the Shelly device* — `.devroom/devices.json` stores the plaintext password, LAN-only tool, no login of its own (M15) |

Default compiler is clean-room DevRoom (`compiler: "devroom"`). Setting
`compiler` to anything else prints `shelly-forge path not wired yet`.

## Commands

```bash
mise install
mise run install          # npm install
mise run build            # Shelly dual artifacts + web bundle
mise run lint             # typecheck shelly + server + web
mise run typecheck        # same as lint
mise run check:lines      # source files ≤ 500 lines
mise run test             # DCE/minify asserts + web + server smoke
                          # accepts a name filter and `--isolated` (see below)
mise run bench            # minify-option benchmark over bench/*.ts
mise run beforeCommit     # check:lines → typecheck → build → test → e2e (node + txiki exe)
mise run start            # DevRoom server (alias: mise run dev)
mise run build:txiki      # bundle txiki server and CLI entries
mise run start:txiki      # start the txiki server bundle
mise run test:txiki       # capabilities and Node/txiki HTTP parity
mise run test:e2e:txiki   # full e2e suite against .txiki/shelly-devroom
mise run deploy -- debug min   # MODE + MINIFY=min|raw
mise run deploy:txiki -- --mode debug --minify min
mise run probe
mise run probe:txiki
mise run profile # cache the device capability profile for Tier 4 lint
mise run profile:txiki
mise run clean
```

Also available via `npm run …` (`build:shelly`, `build:web`, `dev`, `beforeCommit`, …).
Set `DEVROOM_TJS_BIN` when `tjs` is not on `PATH`. txiki needs bundles under
`.txiki/`; npm installation, TypeScript, and Playwright stay on Node.
Build config: `tsconfig.shelly.json` / `tsconfig.server.json` / `tsconfig.web.json`. Entry: `scripts/main.ts`. Pipeline:
`scripts/build-shelly.mjs`.

## What this project is

**Shelly DevRoom** — a local development playground for authoring
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
