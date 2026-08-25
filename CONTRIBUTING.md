# Contributing

Issues and pull requests are welcome. This is a single-maintainer project built
around one specific target — Shelly Gen2 devices running Espruino on an ESP32 —
so the fastest way to get a change merged is to keep it inside that.

## The gate

One command has to be green before anything is committed:

```bash
mise run beforeCommit     # or: npm run beforeCommit — identical
```

It runs, in order: oxlint → line limit → typecheck (device, server, web) →
build → tests → the Playwright e2e suite **twice**, once against the Node server
and once against the compiled txiki single-file executable. CI runs exactly this
command on `ubuntu-latest` and `macos-latest`; there is no CI-only test list to
drift out of sync with it.

It takes roughly 70 seconds on an M-series Mac. No device is needed and none is
touched — every build step compiles `fixtures/device/main.ts` in a per-runner
`.tmp/` workspace, never your live script.

## Rules that are enforced, not suggested

**Files stay under 500 raw lines** — blanks and comments count.
`mise run check:lines` is the single authority; oxlint's `max-lines` is
deliberately off so two half-checks cannot disagree. Over the limit, split it.

**Cyclomatic complexity is capped at 20.** The functions that breached it were
split or turned into dispatch tables rather than suppressed. Please do the same.

**oxlint runs on shellint's own source only** — `server/`, `web/`, `scripts/`,
`shared/`, `e2e/`. It never runs on device code. `scripts/main.ts`, `fixtures/`,
`bench/`, `templates/` and `types/` are ignored on purpose: device code is
ES5 / `noLib` / `types: []` Espruino, and a general-purpose linter can only be
wrong about it. Device code has its own five-tier engine in `server/lint/`.

**`scripts/main.ts` is not part of the repo.** It is your live editor buffer,
gitignored, seeded from `templates/main.example.ts`. Nothing in the gate
compiles it — its size, its findings and whether it parses at all are outside
the repo's control. Never commit it, and never make a gate step depend on it.
`mise run typecheck:script` checks it on demand.

**Design baselines exist per platform.** `e2e/design.spec.ts` compares
screenshots, and there are two sets — `-chromium-darwin`, shot locally against
system Chrome, and `-chromium-linux`, shot by CI. A deliberate design change has
to refresh **both**, or the other runner's leg goes red. This is the one
recurring tax the screenshot tests add; budget for it before changing layout,
spacing or tokens.

## Adding a check

`server/lint/check-catalog.ts` names every check. A new one needs: an entry
there with its rationale, the rule itself in the matching tier module, and a
test. Report `skipped` — never `pass` — when the inputs a rule needs (a device
profile, a probe result, a successful build) are absent. A rule that silently
passes when it could not run is worse than no rule.

Rules whose finding order is compared by the artifact tests live in dispatch
tables where **table order is finding order**. Adding a row moves output; update
the expectations in the same commit.

## Things worth knowing before you start

- **Plans and findings** live in `.claude/`, which is gitignored — they are the
  maintainer's working notes, not repo documentation. `CLAUDE.md` is the
  architecture summary that *is* tracked; keep it accurate when you change
  something it describes.
- **Bun is not supported** anywhere in this repo, and neither is any web
  framework — the router, the HTTP adapter, the charts and the diff are all
  in-repo on purpose. New runtime dependencies need a reason that survives the
  question "what does this cost the 5 MB executable?"
- **The device is the authority**, not general JavaScript knowledge. Check the
  [Language Reference](https://shelly-api-docs.shelly.cloud/gen2/Scripts/LanguageReference)
  before adding anything about the dialect; it is a subset, and it changes.

## Reporting a security issue

Do not open a public issue. See [`SECURITY.md`](./SECURITY.md).
