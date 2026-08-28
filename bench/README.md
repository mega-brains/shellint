# bench/ — minify benchmark corpus

Benchmark **inputs**, not shipped code. Nothing here is deployed, imported by
the app, or compiled by `mise run build`. Run them with:

```sh
node scripts/bench-minify.mjs           # every script, every option set
node scripts/bench-minify.mjs log-heavy # one script
node scripts/bench-minify.mjs --json    # machine-readable
```

## Why this exists

`scripts/main.ts` is one 14.5 KB demo. `passes`, `hoistProps` and
`internStrings` all measured ~0 on it — not because they don't work but
because that one script has nothing for them to chew on. Per the M14b plan,
**no size knob ships on the strength of a measurement taken against
`main.ts`.** Each file here exercises exactly one shape the demo lacks:

| file | shape | knob it is meant to move |
|---|---|---|
| `config-heavy.ts` | large non-escaping config objects, read field-by-field | `hoistProps` |
| `rpc-strings.ts` | the same RPC method / component-key strings repeated many times | `internStrings` |
| `log-heavy.ts` | dense `console.log` with long literal messages | `dropConsole` (and `logMap`) |

A knob measuring ~0 across all four inputs (three above + `main.ts`) is
evidence to retire it, not to keep it.

## Constraints these files are under

They compile under the **device** tsconfig rules — `target: ES5`,
`module: none`, `noLib`, `types: []` — so `types/*.d.ts` is the entire
standard library available: no `Promise`, `Set`, `Symbol`, `RegExp`,
`Array.prototype.map`/`forEach`, `String.prototype.padStart`/`concat`.
`scripts/bench-minify.mjs` compiles each file through a generated tsconfig
that `extends` `config/tsconfig.shelly.base.json`, so a file that drifts out of the
dialect fails the bench run loudly.

They are outside every device tsconfig's `include` (`config/tsconfig.shelly.script.json`
names `scripts/main.ts`, `config/tsconfig.shelly.fixture.json` names the gate's
fixture) and outside `check:lines` — a benchmark input needs bulk
to be representative, and the 500-line limit exists for app source.
