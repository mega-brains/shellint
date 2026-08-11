# Shelly DevRoom

Small, simple development room (playground) for developing shelly scripts

## How to run

1. Copy or edit `devroom.json`:

```json
{
  "deviceIp": "192.168.1.100",
  "scriptId": 1,
  "host": "0.0.0.0",
  "port": 8787,
  "compiler": "devroom"
}
```

| Field | Meaning |
|---|---|
| `deviceIp` | Shelly Gen2+ address on your LAN |
| `scriptId` | Existing script slot to overwrite (no Create) |
| `host` / `port` | DevRoom HTTP bind (default `0.0.0.0:8787`) |
| `compiler` | Must be `"devroom"` for now (`shelly-forge` not wired) |

2. Install and start:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:8787` — edit `scripts/main.ts`, **Save → Build → Deploy** (pick debug|prod). **Probe** runs `Script.Eval` checks and writes `types/generated-probe.json`.

CLI helpers: `npm run build:shelly`, `npm run deploy -- [debug|prod]`, `npm run probe`.

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

