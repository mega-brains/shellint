# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ! IMPORTANT

- read [BASIC_INSTRUCTIONS](./.claude/memory/BASIC_INSTRUCTIONS.md)
- read [plans-file-header](./.claude/memory/plan-file-header-format.md)
- read [plans-in-project-dir](./.claude/memory/plans-in-project-dir.md)


## Status: greenfield

This project currently contains **only `README.md`** — no source, no package manifest,
no tooling, no tests. Everything in the README is intent, not implementation.

There are therefore **no build/lint/test commands yet**. Do not invent or document
them here; when the first stack lands (the README points at Node.js), add the real
commands to this file at that time. Verify with `ls` before assuming any file exists.

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

## Conventions inherited from the monorepo

This directory is one project inside `~/d/IDEAS` — see that repo's
`CLAUDE.md` and `.claude/memory/BASIC_INSTRUCTIONS.md`. Notably:

- Plans/findings go in the **project-local** `.claude/plans/` (not `~/.claude`),
  named `YYYY-MM-DD_slug.md`.
- Every plan/findings file opens with a fenced `Date: / Scope: / Status:` block;
  advance Status as work lands.
- Each project owns its own stack and tooling — nothing is shared across the monorepo.
- `shelly-devroom` is **not yet listed** in the parent `IDEAS/CLAUDE.md` project
  table; add it there once the stack is chosen.
