/*
 * FAQ content for `site/faq.html`, as data rather than JSX — same split as
 * `docs-content.ts`, and the same inline markup (`code`, [label](href),
 * **bold**), rendered by `web/site/inline.tsx`.
 *
 * These questions used to be the last section of the docs page. They are a
 * page of their own because they are what a visitor arrives with, and burying
 * them under nine sections of reference prose meant nobody reached them.
 *
 * Every answer must stay checkable against the code. Where one names a number
 * or a path — 10 history versions, `.shellint/script-history.jsonl` — that is
 * `server/script/script-history.ts`, and it changes when that file does.
 */

export type FaqItem = { id: string; q: string; a: string[] };
export type FaqGroup = { id: string; title: string; items: FaqItem[] };

export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: "using",
    title: "Using it",
    items: [
      {
        id: "what-for",
        q: "What do people actually use it for?",
        a: [
          "Three things, mostly. **Making a big script smaller.** Artifact sizes, the JsVar estimate and the tier-5 advisories say which parts cost the most, so trimming a tangled script is measured rather than guessed — and the `debug ↔ prod` diff shows what the environment gating already removed for free.",
          "**Watching a script you are still developing.** Deploy it, then read live script memory and CPU, RAM, filesystem, temperature and RSSI while it runs, with the debug log streaming next to them. A `print(\"#m <series> <value>\")` line charts itself, so a value you care about becomes a graph without any extra tooling.",
          "**Comparing against what you had before.** See [script history](#history) below.",
        ],
      },
      {
        id: "history",
        q: "Can I compare my script against earlier versions?",
        a: [
          "Yes. **History** in the toolbar keeps the last 10 saved versions with their sizes, and diffs any one of them against the current editor buffer before you decide whether to restore it.",
          "A snapshot is taken before a save overwrites the previous content, so a save never destroys the version it replaces. Identical text is deduped and an editing burst is coalesced, so autosave cannot spend all 10 slots on one minute of typing; **Checkpoint** takes one immediately regardless. They live in `.shellint/script-history.jsonl`, on your machine like everything else.",
        ],
      },
      {
        id: "device-needed",
        q: "Do I need a Shelly to use it?",
        a: [
          "Not to start. With no device configured shellint runs read-only: editor, compiler, artifact sizes, the RAM estimate and the offline check tiers all work, and the device panels sit inert.",
          "A device buys the things that are measurements rather than analysis — deploy, telemetry, the log stream, tier-4 checks and the [capability probe](./probe.html).",
        ],
      },
      {
        id: "demo",
        q: "What can the browser demo not do?",
        a: [
          "It is the same application compiled to run entirely in the page — same compiler, same 66 checks, no server and no network. What it cannot have is a device, so there is no deploy, telemetry, eco toggle or log stream, and no device or slot switching.",
          "The 14 rules that need a device profile, a probe or a `types.d.ts` report **skipped** rather than a false pass. Everything on that list comes back with the [local build](./download.html).",
        ],
      },
    ],
  },
  {
    id: "checks",
    title: "Checks and builds",
    items: [
      {
        id: "own-editor",
        q: "Can I use the checks in my own editor?",
        a: [
          "The syntax half of tier 1 needs no custom rule code: [templates/eslint.config.mjs](https://github.com/mega-brains/shellint/blob/main/templates/eslint.config.mjs) is that half as a flat config to copy into your own repo.",
          "The rest — the cooperative scheduler, the RAM budget, `Shelly.*` existence, the live probe — is not something an off-the-shelf ESLint plugin can express.",
        ],
      },
      {
        id: "no-probe",
        q: "What happens if I never run a probe?",
        a: [
          "The rules that need one report **skipped** — never a pass. Severity also follows provenance: an absence measured on the active device is an error, one inherited from another device or from firmware it no longer runs is only a warning. The [checks reference](./checks.html) lists every rule and what it needs.",
        ],
      },
      {
        id: "shelly-docs",
        q: "Which Shelly documentation is authoritative?",
        a: [
          "Shelly's own, always — the [Language Reference](https://shelly-api-docs.shelly.cloud/gen2/Scripts/LanguageReference) and the [changelog](https://shelly-api-docs.shelly.cloud/gen2/changelog). The API moves, and general JavaScript knowledge is not a guide to what Espruino on an ESP32 implements.",
        ],
      },
    ],
  },
  {
    id: "project",
    title: "The project",
    items: [
      {
        id: "phone-home",
        q: "Does it phone home?",
        a: [
          "The tool never does. Only the hosted demo site may carry a cookieless pageview beacon, injected at build time when this repo's Pages deploy sets `COLLECTOR_ORIGIN`. A local run, a self-built `site/`, a release binary and every fork build have none.",
        ],
      },
      {
        id: "safe",
        q: "Is it safe to expose on my network?",
        a: [
          "No. shellint has no authentication of its own, and `.shellint/devices.json` stores device passwords in plaintext because digest auth needs them back. Anyone who can reach the port owns your devices. Read [Security](./docs.html#security) before binding anything but `127.0.0.1`.",
        ],
      },
      {
        id: "stable",
        q: "Is it stable?",
        a: [
          "Pre-1.0; the API surface may move. The full gate runs green on macOS and Linux in CI, but only macOS arm64 has been exercised end to end by a human — treat the Linux and Windows binaries as working-but-unproven.",
        ],
      },
      {
        id: "licence",
        q: "What licence is it under?",
        a: [
          "None stated yet. The repo carries no LICENSE file and no `license` field in `package.json`, so no permission is being granted here that the project has not actually granted. The [technology page](./stack.html) lists what it is built on and the licences those carry.",
        ],
      },
    ],
  },
];
