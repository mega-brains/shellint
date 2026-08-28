/*
 * Download page (`site/download.html`, M26 plan §6.3). The visual thesis is
 * the size claim — the txiki single-file executable rendered with the same
 * MeasureRow grammar the app uses for artifact sizes, so "one file, no Node,
 * under 5 MB" is shown how shellint shows every other size, not just
 * asserted in prose.
 *
 * The release table is honest about where the project actually is:
 * `scripts/compile-txiki.mjs` only builds for the host platform, and no
 * release workflow exists yet (M26 plan §9), so every release link 404s
 * until the first tag. Ship that plainly rather than dressing up dead links.
 */
import { Fragment } from "preact";
import { MeasureRow, MeasureList, Group } from "../ui/measure";
import { SiteHeader, SiteFooter } from "./landing";
import { releaseAssetUrl, releasesUrl } from "./release";

/* Local .txiki/shellint, macOS arm64, measured 2026-08-18 (M26 plan §2.4). */
// Measured on the v0.0.3 macOS arm64 build (the largest row is Windows at
// 4,922,-odd KB). Grew from 4,506,842 B when the browser assets and the
// device-type declarations moved inside the binary — see release.yml's
// standalone smoke step for why they had to.
const BINARY_BYTES = 4_714_345;
const CAP_BYTES = 5 * 1024 * 1024;

/*
 * One row per asset `.github/workflows/release.yml` actually builds — the two
 * lists have to move together or a link here 404s against the release matrix.
 * macOS x64 is absent on purpose: the slim txiki release publishes no macOS
 * x86_64 asset in any profile, so that row could only ship the full ~5.6 MB
 * build and falsify this page's own headline.
 */
const PLATFORMS: { label: string; asset: string; note?: string }[] = [
  { label: "macOS arm64", asset: "shellint-macos-arm64" },
  { label: "Linux x64", asset: "shellint-linux-x64" },
  { label: "Windows x64", asset: "shellint-windows-x64.exe", note: "unproven" },
];

const LOCAL_ADDS = [
  "Device connection over the LAN, with digest auth to the box",
  "Deploy via WS PutCode, in debug or prod mode, min or raw artifact",
  "Live device status, eco toggle and streamed debug logs",
  "The device-profile- and capability-probe-aware lint tiers (the 14 rules the demo skips)",
  "Multi-device and slot selection",
];

export function Download() {
  return (
    <Fragment>
      <SiteHeader />

      <main class="site-main">
        <section class="hero hero-download">
          <h1>One file. No Node. Under 5 MB.</h1>
          <p class="hero-sub">
            <code>shellint</code> is a single txiki.js executable — the
            whole server, UI and CLI in one binary, no Node install and no{" "}
            <code>npm install</code> required.
          </p>

          <Group title="Binary size" id="sizeGroup" caption="actual vs. 5 MB cap">
            <MeasureList labelWidth={104}>
              <MeasureRow
                label="shellint"
                value={fmtBytes(BINARY_BYTES)}
                fraction={BINARY_BYTES / CAP_BYTES}
                tone="accent"
                soft
                title={`${fmtBytes(BINARY_BYTES)} of a 5 MB advisory cap (macOS arm64)`}
                ariaLabel={`shellint binary, ${fmtBytes(BINARY_BYTES)} of a 5 megabyte cap`}
              />
            </MeasureList>
          </Group>
        </section>

        <section class="downloads">
          <Group title="Releases" id="releases">
            <p class="release-note">
              First release pending — the release workflow exists but no tag has
              been pushed through it yet, so the links below 404 until then.
              Build from source in the meantime (next section). The Windows
              build has never been run anywhere; treat it as unproven.
            </p>
            <table id="downloadTable">
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Asset</th>
                </tr>
              </thead>
              <tbody>
                {PLATFORMS.map((p) => (
                  <tr key={p.asset}>
                    <td>
                      {p.label}
                      {p.note ? <span class="muted"> · {p.note}</span> : null}
                    </td>
                    <td>
                      <a href={releaseAssetUrl(p.asset)}>{p.asset}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              <a href={releasesUrl()} target="_blank" rel="noreferrer">
                All releases on GitHub
              </a>
            </p>
          </Group>
        </section>

        <section class="quickstart">
          <Group title="Quick start" id="quickstart">
            <ol>
              <li>Download the binary for your platform</li>
              <li>
                <code>chmod +x shellint</code>
              </li>
              <li>
                <code>./shellint</code>
              </li>
              <li>
                Open <code>http://localhost:8787</code>
              </li>
            </ol>
            <pre class="curl-line">
              <code>curl -fsSL -o shellint {releaseAssetUrl("shellint-macos-arm64")}{"\n"}chmod +x shellint && ./shellint</code>
            </pre>
          </Group>
        </section>

        <section class="build-from-source">
          <Group title="Build from source" id="buildFromSource">
            <p>
              <code>mise run build:txiki:executable</code> compiles the
              single-file executable for your host platform. If <code>tjs</code>{" "}
              is not on <code>PATH</code>, point{" "}
              <code>SHELLINT_TJS_BIN</code> at a txiki.js build first.
            </p>
          </Group>
        </section>

        <section class="limits">
          <Group title="What the local build adds over the demo" id="localAdds">
            <ul>
              {LOCAL_ADDS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p>
              Nothing here needs an account or a cloud service — the LAN and
              the device are the whole surface.
            </p>
          </Group>
        </section>
      </main>

      <SiteFooter />
    </Fragment>
  );
}

function fmtBytes(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
