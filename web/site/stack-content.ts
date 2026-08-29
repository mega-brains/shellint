/*
 * Credits for `site/stack.html` — the open-source work shellint is built on.
 *
 * Versions and licences are copied from `package.json` and the installed
 * packages, not guessed. When a dependency is bumped, the version here is
 * stale until someone updates it; `web/site/stack.tsx` says so on the page
 * rather than implying the list regenerates itself.
 *
 * Only direct dependencies are listed. The transitive tree is npm's business
 * and a page nobody reads.
 */

export type StackItem = {
  name: string;
  version: string;
  licence: string;
  href: string;
  what: string;
};

export type StackGroup = { id: string; title: string; about: string; items: StackItem[] };

/** Mirrors `package.json` — one runtime dependency, everything else at build time. */
export const STACK_GROUPS: StackGroup[] = [
  {
    id: "runtime",
    title: "Ships at runtime",
    about:
      "The whole runtime dependency list, and it is one entry. Everything else on this page is a build or development tool that never reaches a running server.",
    items: [
      {
        name: "ws",
        version: "8.21.3",
        licence: "MIT",
        href: "https://github.com/websockets/ws",
        what: "The WebSocket client behind device deploys (`PutCode`), the RPC calls and the `/debug/log` stream.",
      },
    ],
  },
  {
    id: "editor",
    title: "The editor and UI",
    about:
      "The browser half. No framework, no router, no component library — Preact plus CodeMirror, and hand-rolled SVG for the charts and diffs.",
    items: [
      {
        name: "Preact",
        version: "10.29.8",
        licence: "MIT",
        href: "https://preactjs.com",
        what: "The UI, at roughly a tenth of React's bytes — which matters when the whole site is also a downloadable executable.",
      },
      {
        name: "CodeMirror 6",
        version: "6.x",
        licence: "MIT",
        href: "https://codemirror.net",
        what: "The code editor: state, view, JavaScript language support, autocomplete, search and commands, wired up by hand rather than through `basicSetup`.",
      },
      {
        name: "Lezer",
        version: "1.2.3",
        licence: "MIT",
        href: "https://lezer.codemirror.net",
        what: "The parser and highlighter under CodeMirror's language support.",
      },
    ],
  },
  {
    id: "pipeline",
    title: "The build pipeline",
    about:
      "What turns a TypeScript file into something an ESP32 will accept — and what bundles the tool itself.",
    items: [
      {
        name: "TypeScript",
        version: "5.9.3",
        licence: "Apache-2.0",
        href: "https://www.typescriptlang.org",
        what: "Compiles device code to ES5 with a flat emit, `noLib` and `types: []`. The same compiler runs in the browser demo, via `ts.transpileModule`.",
      },
      {
        name: "Terser",
        version: "5.49.2",
        licence: "BSD-2-Clause",
        href: "https://terser.org",
        what: "Minification tier 2, after `meta.env` dead-code elimination — the step most of the size saving comes from.",
      },
      {
        name: "Espruino tools",
        version: "0.1.67",
        licence: "Apache-2.0",
        href: "https://github.com/espruino/EspruinoTools",
        what: "Minification tier 3 (`espruino --minify`). Optional: with it absent, the `*.adv.js` artifacts are simply not produced.",
      },
      {
        name: "esbuild",
        version: "0.28.2",
        licence: "MIT",
        href: "https://esbuild.github.io",
        what: "Bundles the web UI, this site and the txiki executable. Not used for device code — that path is `tsc` exactly.",
      },
      {
        name: "tsx",
        version: "4.23.12",
        licence: "MIT",
        href: "https://tsx.is",
        what: "Runs the server's TypeScript directly in development, so there is no build step between an edit and a reload.",
      },
    ],
  },
  {
    id: "runtimes",
    title: "Runtimes",
    about: "Two of them, behind conditional adapters — plus the one on the device, which is neither.",
    items: [
      {
        name: "Node.js",
        version: "≥ 20",
        licence: "MIT",
        href: "https://nodejs.org",
        what: "The default runtime. `node:http` is adapted to a `fetch`-style handler so both runtimes share one router.",
      },
      {
        name: "txiki.js",
        version: "26.6.0",
        licence: "MIT",
        href: "https://github.com/saghul/txiki.js",
        what: "A small JavaScript runtime built on QuickJS and libuv. `tjs compile` is what makes the single-file release executable possible at under 5 MB.",
      },
      {
        name: "Espruino",
        version: "on-device",
        licence: "MPL-2.0",
        href: "https://www.espruino.com",
        what: "Not a dependency — the JavaScript interpreter running on the Shelly itself. Its limits are the reason every check tier exists.",
      },
    ],
  },
  {
    id: "quality",
    title: "Tests and hygiene",
    about: "The gate. All of it development-only; none of it ships.",
    items: [
      {
        name: "Playwright",
        version: "1.62.1",
        licence: "Apache-2.0",
        href: "https://playwright.dev",
        what: "End-to-end and visual-regression tests, run on the bundled headless shell against committed per-platform baselines.",
      },
      {
        name: "oxlint",
        version: "1.80.0",
        licence: "MIT",
        href: "https://oxc.rs",
        what: "Lints shellint's own source — correctness, suspicious patterns and a cyclomatic-complexity cap. Never run on device code.",
      },
      {
        name: "node:test",
        version: "built in",
        licence: "MIT",
        href: "https://nodejs.org/api/test.html",
        what: "The unit and artifact tests. No test framework is installed; the runtime already has one.",
      },
      {
        name: "mise",
        version: "any",
        licence: "MIT",
        href: "https://mise.jdx.dev",
        what: "Pins the toolchain and names the tasks. Optional — every `mise run …` exists as an `npm run …`.",
      },
    ],
  },
];
