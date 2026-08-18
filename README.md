# shellint

Small, simple development room (playground) for developing shelly scripts

## How to run

1. Copy or edit `shellint.json`:

```json
{
  "host": "0.0.0.0",
  "port": 8787,
  "compiler": "shellint"
}
```

| Field | Meaning |
|---|---|
| `host` / `port` | shellint HTTP bind (default `0.0.0.0:8787`) |
| `compiler` | Must be `"shellint"` for now (`shelly-forge` not wired) |

Devices are no longer configured in `shellint.json` — add one from UI
header device picker (`+ Add device…`), which stores it in `.shellint/devices.json`
(gitignored, `0600`; the password field is plaintext — this is a LAN-only tool
with no login of its own). Migration: if `shellint.json` is absent, legacy
`devroom.json` remains readable once. Rename it, then move `.devroom/` to
`.shellint/` yourself; credentials are never moved automatically.

2. Install and start (mise preferred):

```bash
mise install && mise run install
mise run start
# or: npm install && npm run dev
```

Open `http://127.0.0.1:8787` — edit `scripts/main.ts`, **Save → Build → Deploy**.
The header's device picker switches the active device; a second picker next to
it switches the active script slot on that device (`+ New slot…` /
`Delete slot…`, typed-name confirm before a delete). Switching device or slot
is server-global — this is a single-operator LAN tool, not a multi-tab
per-target setup — and resets the device panel and log stream so they never
blend two devices' data.
Deploy is a split button: main click reuses last choice; ▾ picks
**debug|prod** × **minified|non-minified**. **Check** runs the Shelly/Espruino
compliance pass — it works offline, and when the device is answering it also
checks RPC method names, component ids and firmware capabilities against that
device. **Probe** runs `Script.Eval` checks and
writes `types/generated-probe.json`; it never overwrites stored device scripts —
if configured slot is not running it creates throwaway `shellint-probe`
slot and deletes it again. The footer polls live device telemetry (script
mem/cpu, RAM/FS, latency, RSSI) and has an **eco** toggle.

A resizable sidebar beside the editor holds two panels. **build** carries sizes per
mode, script counters, resource gauges against the device caps, a **static RAM
estimate** (a JsVar cost model — an estimate, drawn against the device's measured
`mem_peak` so the error stays visible), the **minimum firmware** the script's API use
requires, and size plus estimate over recent builds. **check** is a permanent
indicator: it lists every compliance check with a one-line rationale and its verdict,
including the ones **skipped** for want of a device profile or a build. The **logs**
panel enables `sys.debug.websocket` on the device
and streams `ws://<ip>/debug/log`; numeric series are charted from a print
convention:

```js
print("#m temp " + tC); // "#m <series> <value>"
```

Charts are hand-rolled inline SVG — no charting dependency. The device's log buffer
is circular, so dropped lines render as gaps rather than interpolated lines.

### Optional txiki.js runtime

Node.js remains the default runtime. txiki.js `v26.6.0` is supported as an
opt-in server and CLI runtime. It runs a bundle because txiki does not resolve
npm packages or parse TypeScript directly.

Put `tjs` on `PATH`, or point at a local executable:

```bash
export SHELLINT_TJS_BIN=/path/to/txiki.js/build/tjs
mise run build:txiki
mise run start:txiki
```

This repository's `mise.toml` pins txiki.js `26.6.0` and resolves the sibling
clone at `../../txiki.js/build/tjs`. `SHELLINT_TJS_BIN` may still override it.

Build one standalone native executable:

```bash
mise run build:txiki:executable
./.txiki/shellint
```

Executable embeds txiki runtime plus bundled server code. shellint remains
workspace tool, so mutable project files (`shellint.json`, `scripts/`, `types/`,
`dist/`, `web/dist/`, and `.shellint/`) are still read from launch directory.

Peer CLI and verification tasks are available:

```bash
mise run deploy:txiki -- --mode debug --minify min
mise run probe:txiki
mise run profile:txiki
mise run test:txiki
```

txiki builds require WebCrypto, filesystem, process, WebSocket, and HTTP server
features. npm installation, TypeScript checks, and Playwright remain Node-hosted.
Static/offline mode stays independent from both server runtimes.

```bash
mise run build
mise run deploy -- debug min    # or: prod raw
mise run probe
mise run profile                # cache device capabilities for the connected lint
mise run test
mise run beforeCommit           # lines + typecheck + build + test
```

Unauthenticated devices only; a 401 surfaces as **auth not supported yet**.

## Using the checks in your editor

shellint checks run behind **Check** button — they are hand-rolled
TypeScript-AST passes, not a linter, because none of the cooperative scheduler,
the RAM budget, `Shelly.*` existence or the live capability probe is something
an off-the-shelf ESLint plugin can express.

The *syntax* half of Tier 1 is another matter: it needs no custom rule code at
all. [`templates/eslint.config.mjs`](./templates/eslint.config.mjs) is that
half as a flat config you can copy into your own Shelly script repo, so your
editor and CI flag same dialect bans shellint does. It is template —
shellint itself neither installs nor runs ESLint.

Rationale, the plugin survey behind it, and what it deliberately leaves out:
[`.claude/plans/2026-08-15_19_lint-gaps-and-eslint.md`](./.claude/plans/2026-08-15_19_lint-gaps-and-eslint.md).

## Ideas / Features

- node.js server app with code editor
- ability to create Shelly scripts in TypeScript with type safety
- custom oxlint (or eslint) plugins / checks / rules specific to Shelly ecosystem (espruino)
  - see (related to scripts):
    - https://shelly-api-docs.shelly.cloud/gen2/Scripts/Overview
    - https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/AES
    - https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/HTTPServer
    - https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/RPCHandlers
    - https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Shelly
    - https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Timer
    - https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Utilities
    - https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Virtual
    - https://shelly-api-docs.shelly.cloud/gen2/Scripts/LanguageReference
    - https://shelly-api-docs.shelly.cloud/gen2/Scripts/Tutorial
  - changelog: https://shelly-api-docs.shelly.cloud/gen2/changelog
  - see also:
    - https://shelly-api-docs.shelly.cloud/gen2/General/CommonErrors
    - https://shelly-api-docs.shelly.cloud/gen2/General/DebugLogs
    - https://shelly-api-docs.shelly.cloud/gen2/General/FirmwareUpdatePolicy
    - https://shelly-api-docs.shelly.cloud/gen2/General/LocalNetworkMessaging
    - https://shelly-api-docs.shelly.cloud/gen2/General/Notifications
    - https://shelly-api-docs.shelly.cloud/gen2/General/RPCChannels
    - https://shelly-api-docs.shelly.cloud/gen2/General/RPCProtocol
    - https://shelly-api-docs.shelly.cloud/gen2/General/SafeMode
    - [https://shelly-api-docs.shelly.cloud/cloud-control-api/communication-v2
    - https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Script
    - https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Shelly
    - https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Switch
    - https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Sys
    - https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Temperature
    - https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Webhook
    - https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/WiFi
    - https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Ws

- simple dashboard to provide basic statistics about script size in the time, with previous versions, various counts:
  - count of used Shelly APIs
  - count of defined variables / constants / strings / console logs / http requests / debug logs
  - script size (raw - unminified, minified, with advanced minification)
  - computed or estimated memory size
  - live data from shelly device at runtime
  - indicating if script is running in the shelly device
  - basic information about shelly device (used ESP32 chip) and:
    - memory size and usage, 
    - cpu usage, 
    - temperature
    - latency in ms for responding
  - toggle for Shelly Eco mode (on/off) with live indication
- ability to define meta.env.debug / meta.env.prod for build time feature gating
  - for example to create production minified build without debug logs or with shorter strings in logs, ...
- ability to parse custom debug logs with numeric data in realtime graphs (uPlot)
