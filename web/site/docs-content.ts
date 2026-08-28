/*
 * Documentation content for `site/docs.html`, as data rather than as JSX.
 *
 * Prose lives here and rendering lives in `docs.tsx` for two reasons: the
 * ≤500-line limit (`scripts/check-line-limit.mjs`) bites quickly when markup
 * and copy share a file, and an editing pass over the docs then never touches
 * a component. The block union is deliberately small — no Markdown parser,
 * because the site ships no parsing dependency and only ever needs paragraphs,
 * code, lists, tables and one callout.
 *
 * Everything here restates README.md. When the README's quick start, security
 * section or command list changes, this file changes with it; nothing
 * generates one from the other.
 */

/** Inline markup understood by `renderInline` in docs.tsx: `code` and [label](href). */
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
        text: "The zip stores the executable bit, so there is no `chmod` step. From a checkout instead:",
      },
      { kind: "code", text: "mise install && mise run install\nmise run start" },
      {
        kind: "p",
        text: "Without mise, `npm install && npm run dev`. Either way, open `http://127.0.0.1:8787` and edit `scripts/main.ts` — created for you from `templates/main.example.ts` on first run.",
      },
      {
        kind: "p",
        text: "No device required. With none configured shellint starts read-only: editor, compiler, sizes and the offline check tiers all work, and the device panels sit inert.",
      },
    ],
  },
  {
    id: "security",
    title: "Security",
    blocks: [
      {
        kind: "warn",
        text: "shellint has no authentication of its own. Anyone who can reach the port can edit, build and deploy scripts, read your device credentials back out of the UI, toggle eco mode and reboot the device.",
      },
      {
        kind: "p",
        text: "The `shellint.json` committed in the repo binds `0.0.0.0` — the whole LAN, on first start, without you choosing it. The code default when no config file exists is `127.0.0.1`. To get the safe one, say so explicitly:",
      },
      {
        kind: "code",
        text: '{ "host": "127.0.0.1", "port": 8787, "compiler": "shellint" }',
      },
      {
        kind: "list",
        items: [
          "Device passwords are stored in plaintext in `.shellint/devices.json` (gitignored, `0600`). Digest auth to the device needs the password back, so it is not hashed — treat that file as a credential store.",
          "This is a LAN tool. Do not put it on a routable interface, behind a tunnel, or in front of the internet. There is nothing in it that would survive a hostile network.",
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
        text: "shellint is a workspace tool: everything it reads and writes lives in the directory it was started from, including for the release binary.",
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
        text: "On first run in an empty directory the release binary materialises the files it has to be able to read back — the template and the three `types/*.d.ts` — and never overwrites an existing one.",
      },
    ],
  },
  {
    id: "build",
    title: "Build and artifacts",
    blocks: [
      {
        kind: "p",
        text: "`tsc` compiles to ES5 with a flat emit, then `meta.env` dead-code elimination produces `*.raw.js`, Terser produces `*.js`, and `espruino --minify` — when that binary is installed — produces `*.adv.js`.",
      },
      {
        kind: "p",
        text: "`meta.env.debug` and `meta.env.prod` are build-time constants, so a branch guarded by one is gone from the other build rather than merely unreachable. Production builds also shorten log strings and ship a map the logs panel re-expands, so a shortened `print` still reads correctly in the UI.",
      },
      {
        kind: "p",
        text: "Any built artifact previews read-only in the editor from the chip strip above it, including a unified `debug ↔ prod` diff — useful for seeing exactly what the environment gating removed.",
      },
    ],
  },
  {
    id: "checks",
    title: "Checks",
    blocks: [
      {
        kind: "p",
        text: "66 named checks in five tiers plus a post-compile dialect guard. Every run reports pass / warn / fail / skipped per rule with a one-line rationale, so a script that does not parse or type-check says so instead of quietly passing over a recovered AST. Two tier-3 findings carry autofixes, previewed as a diff.",
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
        text: "The capability probe adds `probe-absent-api` from 104 `Script.Eval` expressions run against real hardware. Severity follows provenance: an absence measured on the active device is an error, an inherited one is a warning.",
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
        text: "Add a device from the header picker (`+ Add device…`); digest auth is supported. Devices are not configured in `shellint.json` — the picker writes `.shellint/devices.json`.",
      },
      {
        kind: "list",
        items: [
          "**Deploy** over WS `PutCode`, choosing debug or prod and the minified or raw artifact.",
          "**Telemetry** — script mem/cpu, RAM/FS, latency and RSSI, plus an eco toggle and reboot.",
          "**Logs** streamed from `ws://<ip>/debug/log`. A `print(\"#m <series> <value>\")` line charts itself as a numeric series.",
          "**Profile** (`mise run profile`) caches `ListMethods`, components, generation and firmware — this is what tier 4 reads.",
          "**Probe** (`mise run probe`) evaluates 104 expressions on the box to find out what really exists on it.",
        ],
      },
      {
        kind: "p",
        text: "Switching device or slot is server-global and resets the device panel and log stream, so two devices' data never blend.",
      },
    ],
  },
  {
    id: "commands",
    title: "Commands",
    blocks: [
      {
        kind: "p",
        text: "Every `mise run …` below exists as `npm run …` too, with identical behaviour. `mise tasks` lists the rest.",
      },
      {
        kind: "code",
        text: [
          "mise run start            # server (alias: dev)",
          "mise run build            # device artifacts + web bundle",
          "mise run test             # unit + smoke; accepts a name filter",
          "mise run deploy -- debug min    # or: prod raw",
          "mise run probe            # 104 capability probes",
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
        text: "The [demo](./demo/) is the same application, compiled to run entirely in the page — it builds and checks offline, with no server and no network. What it cannot have is a device.",
      },
      {
        kind: "list",
        items: [
          "No device connection, deploy, telemetry, eco toggle or log stream.",
          "The 14 rules that need a device profile, a capability probe or a `types.d.ts` report **skipped** rather than a false pass.",
          "No multi-device or slot selection.",
        ],
      },
      {
        kind: "p",
        text: "Everything on that list comes back with the [local build](./download.html).",
      },
    ],
  },
  {
    id: "faq",
    title: "Questions",
    blocks: [
      {
        kind: "p",
        text: "**Does it phone home?** The tool never does. The hosted demo site only may carry a cookieless pageview beacon, injected at build time and only when this repo's Pages deploy sets `COLLECTOR_ORIGIN`. A local run, a self-built `site/`, a release binary and every fork build have no beacon at all.",
      },
      {
        kind: "p",
        text: "**Can I use the checks in my own editor?** The syntax half of tier 1 needs no custom rule code: [templates/eslint.config.mjs](https://github.com/mega-brains/shellint/blob/main/templates/eslint.config.mjs) is that half as a flat config to copy into your own Shelly script repo. The rest — the cooperative scheduler, the RAM budget, `Shelly.*` existence, the live probe — is not expressible as an off-the-shelf ESLint plugin.",
      },
      {
        kind: "p",
        text: "**Which Shelly documentation is authoritative?** Shelly's own, always — in particular the [Language Reference](https://shelly-api-docs.shelly.cloud/gen2/Scripts/LanguageReference) and the [changelog](https://shelly-api-docs.shelly.cloud/gen2/changelog). The API moves.",
      },
      {
        kind: "p",
        text: "**Is it stable?** Pre-1.0; the API surface may move. The full gate runs green on macOS and Linux in CI, but only macOS arm64 has been exercised end to end by a human — treat the Linux and Windows binaries as working-but-unproven.",
      },
    ],
  },
];
