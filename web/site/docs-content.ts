/*
 * Documentation content for `site/docs.html`, as data rather than JSX.
 *
 * Prose here, rendering in `docs.tsx`: the ≤500-line limit
 * (`scripts/check-line-limit.mjs`) bites when markup and copy share a file,
 * and an editing pass then never touches a component. The block union stays
 * small — no Markdown parser, since the page needs only paragraphs, code,
 * lists, tables and one callout.
 *
 * Everything here restates README.md. When the README's quick start, security
 * section or command list changes, this file changes with it; nothing
 * generates one from the other.
 */

/** Inline markup understood by `renderInline` in inline.tsx: `code`, [label](href), **bold**. */
export type Block =
  | { kind: "p"; text: string }
  | { kind: "code"; text: string }
  | { kind: "list"; ordered?: boolean; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "warn"; text: string };

export type DocSection = {
  id: string;
  title: string;
  blocks: Block[];
};

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "install",
    title: "Install and run",
    blocks: [
      {
        kind: "p",
        text: "Two ways in. The release binary is one self-contained file — no Node, no `npm install`, under 5 MB:",
      },
      {
        kind: "code",
        text: "curl -fsSL -O https://github.com/mega-brains/shellint/releases/latest/download/shellint-macos-arm64.zip\nunzip shellint-macos-arm64.zip\n./shellint",
      },
      {
        kind: "p",
        text: "The zip keeps the executable bit, so no `chmod` step. From a checkout instead:",
      },
      { kind: "code", text: "mise install && mise run install\nmise run start" },
      {
        kind: "p",
        text: "Without mise, `npm install && npm run dev`. Either way, open `http://127.0.0.1:8787` and edit `scripts/main.ts` — created from `templates/main.example.ts` on first run.",
      },
      {
        kind: "p",
        text: "No device required. With none configured, shellint starts read-only: editor, compiler, sizes and the offline check tiers work; the device panels sit inert.",
      },
    ],
  },
  {
    id: "security",
    title: "Security",
    blocks: [
      {
        kind: "warn",
        text: "shellint has no authentication of its own. Anyone who reaches the port can edit, build and deploy scripts, read your device credentials out of the UI, toggle eco mode and reboot the device.",
      },
      {
        kind: "p",
        text: "The `shellint.json` committed in the repo binds `0.0.0.0` — the whole LAN, on first start. The code default with no config file is `127.0.0.1`. To get the safe one, say so explicitly:",
      },
      {
        kind: "code",
        text: '{ "host": "127.0.0.1", "port": 8787, "compiler": "shellint" }',
      },
      {
        kind: "list",
        items: [
          "Device passwords sit in plaintext in `.shellint/devices.json` (gitignored, `0600`). Digest auth needs the password back, so it is not hashed — treat that file as a credential store.",
          "This is a LAN tool. Keep it off routable interfaces, tunnels and the internet — nothing in it survives a hostile network.",
        ],
      },
      {
        kind: "p",
        text: "See [SECURITY.md](https://github.com/mega-brains/shellint/blob/main/.github/SECURITY.md) for the threat model and how to report something.",
      },
    ],
  },
  {
    id: "workspace",
    title: "The workspace",
    blocks: [
      {
        kind: "p",
        text: "Everything shellint reads and writes lives in the directory it was started from — the release binary included.",
      },
      {
        kind: "table",
        head: ["Path", "What it is"],
        rows: [
          ["`scripts/main.ts`", "your script — the editor buffer, seeded from `templates/main.example.ts`"],
          ["`types/*.d.ts`", "the entire stdlib for device code; the compile is `noLib` with `types: []`"],
          ["`dist/`", "build output — `{debug,prod}.{raw.js,js,adv.js}`"],
          ["`shellint.json`", "host, port, compiler and minify settings"],
          ["`.shellint/devices.json`", "device list, active device/slot, and passwords — gitignored, `0600`"],
        ],
      },
      {
        kind: "p",
        text: "On first run in an empty directory, the release binary writes out the files it must read back — the template and the three `types/*.d.ts` — and never overwrites an existing one.",
      },
    ],
  },
  {
    id: "build",
    title: "Build and artifacts",
    blocks: [
      {
        kind: "p",
        text: "`tsc` compiles to ES5 with a flat emit. Then `meta.env` dead-code elimination gives `*.raw.js`, Terser gives `*.js`, and `espruino --minify` — when installed — gives `*.adv.js`.",
      },
      {
        kind: "p",
        text: "`meta.env.debug` and `meta.env.prod` are build-time constants: a branch guarded by one is gone from the other build, not merely unreachable. Prod builds also shorten log strings and ship a map the logs panel re-expands, so a shortened `print` still reads correctly.",
      },
      {
        kind: "p",
        text: "Any artifact previews read-only from the chip strip above the editor, including a `debug ↔ prod` diff that shows what the environment gating removed.",
      },
    ],
  },
  {
    id: "checks",
    title: "Checks",
    blocks: [
      {
        kind: "p",
        text: "66 named checks in five tiers, plus a post-compile dialect guard. Every run reports pass / warn / fail / skipped per rule with a one-line rationale, so a script that does not parse or type-check says so instead of passing over a recovered AST. Two tier-3 findings carry autofixes, previewed as a diff.",
      },
      {
        kind: "table",
        head: ["Tier", "Catches", "Needs"],
        rows: [
          ["1 · dialect", "JS the Espruino build on the device does not implement", "nothing"],
          ["2 · resource caps", "firmware limits on registrations, storage and names", "nothing"],
          ["3 · semantics", "runtime behaviour neither types nor a generic linter can express", "nothing"],
          ["4 · connected device", "APIs missing on this device's generation or firmware", "device profile"],
          ["5 · size advisories", "bytes and RAM, where memory is the binding constraint", "artifacts"],
        ],
      },
      {
        kind: "p",
        text: "The capability probe adds `probe-absent-api` from 109 `Script.Eval` expressions run on real hardware. Severity follows provenance: an absence measured on the active device is an error, an inherited one a warning.",
      },
      {
        kind: "p",
        text: "Every rule is listed with its rationale on the [checks reference](./checks.html).",
      },
    ],
  },
  {
    id: "device",
    title: "Working with a device",
    blocks: [
      {
        kind: "p",
        text: "Add a device from the header picker (`+ Add device…`); digest auth is supported. Devices live in `.shellint/devices.json`, written by the picker — not in `shellint.json`.",
      },
      {
        kind: "list",
        items: [
          "**Deploy** over WS `PutCode`, choosing debug or prod and the minified or raw artifact.",
          "**Telemetry** — script mem/cpu, RAM/FS, latency and RSSI, plus eco toggle and reboot.",
          "**Logs** streamed from `ws://<ip>/debug/log`. A `print(\"#m <series> <value>\")` line charts itself.",
          "**Profile** (`mise run profile`) caches `ListMethods`, components, generation and firmware — what tier 4 reads.",
          "**Probe** (`mise run probe`) evaluates 109 expressions on the box to see what really exists.",
        ],
      },
      {
        kind: "p",
        text: "Switching device or slot is server-global and resets the panel and log stream, so two devices' data never blend.",
      },
    ],
  },
  {
    id: "commands",
    title: "Commands",
    blocks: [
      {
        kind: "p",
        text: "Every `mise run …` below exists as `npm run …`, identically. `mise tasks` lists the rest.",
      },
      {
        kind: "code",
        text: [
          "mise run start            # server (alias: dev)",
          "mise run build            # device artifacts + web bundle",
          "mise run test             # unit + smoke; accepts a name filter",
          "mise run deploy -- debug min    # or: prod raw",
          "mise run probe            # 109 capability probes",
          "mise run profile          # cache device capabilities for tier 4",
          "mise run beforeCommit     # the full gate",
          "mise run build:static     # the offline site/ build",
        ].join("\n"),
      },
    ],
  },
  {
    id: "config",
    title: "Configuration",
    blocks: [
      { kind: "p", text: "`shellint.json`, at the root of the workspace:" },
      {
        kind: "table",
        head: ["Field", "Meaning"],
        rows: [
          ["`host` / `port`", "HTTP bind. Code default `127.0.0.1:8787`; the committed file says `0.0.0.0` — see [Security](#security)"],
          ["`compiler`", 'Must be `"shellint"` (`shelly-forge` is not wired)'],
          ["`minify`", "Terser and tier-3 knobs used by the device build"],
        ],
      },
    ],
  },
  {
    id: "demo",
    title: "What the browser demo cannot do",
    blocks: [
      {
        kind: "p",
        text: "The [demo](./demo/) is the same application, compiled to run in the page: it builds and checks offline, no server, no network. What it cannot have is a device.",
      },
      {
        kind: "list",
        items: [
          "No device connection, deploy, telemetry, eco toggle or log stream.",
          "The 14 rules needing a device profile, probe or `types.d.ts` report **skipped**, never a false pass.",
          "No multi-device or slot selection.",
        ],
      },
      {
        kind: "p",
        text: "Everything on that list comes back with the [local build](./download.html). More questions are answered on the [FAQ](./faq.html).",
      },
    ],
  },
];
