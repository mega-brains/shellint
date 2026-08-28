# `types/`

The whole standard library device code gets. The Shelly compile runs with
`noLib` and `types: []` (see `config/tsconfig.shelly.base.json`), so nothing here is
optional — if a global is not declared in this directory, device code cannot
use it.

| File | What it is |
|---|---|
| `shelly.d.ts` | The `Shelly.*` / `Timer.*` / HTTPServer / RPC surface, hand-written |
| `espruino-lib.d.ts` | The Espruino builtins the device runtime provides |
| `meta.d.ts` | `meta.env.debug` / `meta.env.prod`, the build-time gating flags |
| `api-docs.json` | The shellint HTTP API, rendered by the UI's docs pane |
| `device-profile.json` | **Sample data** — see below |
| `generated-probe.json` | **Sample data** — see below |
| `generated.d.ts` | Generated from `generated-probe.json`; do not edit by hand |

## The two sample-data files

`device-profile.json` and `generated-probe.json` are committed **with a real
device's answers in them**, deliberately. They are what Tier 4 lint and the
`probe-absent-api` rule read, so shipping them means a fresh clone gets working
device-aware checks instead of 14 rules reporting `skipped`.

They describe the maintainer's own device, and they name it:

- model (`S3PL-00112EU`), generation and firmware version,
- its **LAN address** (`192.168.3.106`, also baked into the `generated.d.ts`
  header comment) — an RFC 1918 address, not routable from outside that network,
- the timestamp of the run that produced them.

No credential is in either file; device passwords live in `.shellint/devices.json`,
which is gitignored.

**They are not your device.** Two consequences:

1. Findings from them are advisory. When a probe result comes from the *active*
   device, `probe-absent-api` reports **error** — a ReferenceError on the box
   your next Deploy writes to. When it comes from a different device or none is
   active, as these do, it reports **warn**.
2. `mise run profile` and `mise run probe` **overwrite both files** from
   whichever device is active, and `mise run probe` regenerates `generated.d.ts`
   with it. Expect a diff here after either command; expect your own device's
   address to appear in it.

The authoritative per-device copies live under `.shellint/devices/<id>/`
(gitignored). These two files are mirrors of whichever device is selected.
