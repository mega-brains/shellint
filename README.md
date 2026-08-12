# Shelly DevRoom

Small, simple development room (playground) for developing shelly scripts

## How to run

1. Copy or edit `devroom.json`:

```json
{
  "host": "0.0.0.0",
  "port": 8787,
  "compiler": "devroom"
}
```

| Field | Meaning |
|---|---|
| `host` / `port` | DevRoom HTTP bind (default `0.0.0.0:8787`) |
| `compiler` | Must be `"devroom"` for now (`shelly-forge` not wired) |

Devices are no longer configured in `devroom.json` — add one from the UI's
header device picker (`+ Add device…`), which stores it in `.devroom/devices.json`
(gitignored, `0600`; the password field is plaintext — this is a LAN-only tool
with no login of its own). A legacy `devroom.json` with `deviceIp`/`scriptId`
still works: the first server start migrates it into `.devroom/devices.json`
automatically, one-way, without touching `devroom.json` itself.

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
if the configured slot is not running it creates a throwaway `devroom-probe`
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

```bash
mise run build
mise run deploy -- debug min    # or: prod raw
mise run probe
mise run profile                # cache device capabilities for the connected lint
mise run test
mise run beforeCommit           # lines + typecheck + build + test
```

Unauthenticated devices only; a 401 surfaces as **auth not supported yet**.

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

