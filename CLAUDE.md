# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ! IMPORTANT

- read [BASIC_INSTRUCTIONS](./.claude/memory/BASIC_INSTRUCTIONS.md)
- read [plans-file-header](./.claude/memory/plan-file-header-format.md)
- read [plans-in-project-dir](./.claude/memory/plans-in-project-dir.md)


## Status: M0–M4 basic · M5–M10 done (lint Tier 1–5, incl. connected Tier 4) · M11 type-layer bans · M12 dashboard metrics

Prefer **mise** tasks ([`mise.toml`](./mise.toml)). Verify with `ls` / `mise tasks`
before assuming entrypoints exist.

Pre-commit gate: `mise run beforeCommit` (line limit ≤500, typecheck shelly/server/web,
build, test).

## Stack (committed)

| Layer | Choice |
|---|---|
| Runtime | Node 22 via mise (`"type": "module"`) |
| Task runner | mise (`start`/`dev`, `build`, `lint`, `test`, `beforeCommit`, `probe`, `clean`) |
| Device compile | `tsc` → ES5, `module: none`, `noEmitHelpers`, `noLib` + `types: []` |
| Env gating | `meta.env` DCE → `*.raw.js`; then Terser minify → `*.js` |
| Emit | Flat (no IIFE) → `dist/{debug,prod}.{raw.js,js}` |
| Types | `types/shelly.d.ts`, `types/espruino-lib.d.ts`, `types/meta.d.ts` — the whole stdlib for device code, since `noLib` drops `lib.es*` (M11) |
| Config | `devroom.json` (`deviceIp`, `scriptId`, `host`, `port`, `compiler`) |
| Server / UI | Hono + CodeMirror 6 |
| Deploy | WS PutCode; mode debug/prod + artifact min/raw |
| Live telemetry | `GET /api/device/status` + eco toggle (M5) |
| Dashboard metrics | `/api/stats` → `estimate` (JsVar model) + `minFirmware`; size sparkline; estimate vs live `mem_peak` (M12) |
| Debug logs | `GET`/`POST /api/device/logs` — server holds the one `/debug/log` socket, browser polls; `print("#m <series> <value>")` charts numerically (M12) |
| Charts | Hand-rolled inline SVG (`web/spark.ts`). **No uPlot** — deliberately dependency-free |
| Compliance | `POST /api/check` — source lint Tier 1–5 + post-compile dialect guard (M8–M10) |
| Device profile | `types/device-profile.json` (`ListMethods` + components + gen/fw) drives Tier 4; refreshed when the device answers |
| Auth | None for now |

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
mise run beforeCommit     # check:lines → typecheck → build → test
mise run start            # DevRoom server (alias: mise run dev)
mise run deploy -- debug min   # MODE + MINIFY=min|raw
mise run probe
mise run profile # cache the device capability profile for Tier 4 lint
mise run clean
```

Also available via `npm run …` (`build:shelly`, `build:web`, `dev`, `beforeCommit`, …).
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

