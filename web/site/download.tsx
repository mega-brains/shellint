/*
 * Download page (`site/download.html`, M26 plan §6.3). The visual thesis is
 * Release assets come from GitHub's latest-release API. Names, URLs, and
 * compressed sizes therefore always match what is currently downloadable.
 */
import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Group } from "../ui/measure";
import { useTheme } from "../shell/theme";
import { SiteHeader, SiteFooter } from "./landing";
import { latestReleaseApiUrl, releaseAssetUrl, releasesUrl } from "./release";

type ReleaseAsset = {
  name: string;
  size: number;
  browser_download_url: string;
};

type LatestRelease = {
  tag_name: string;
  published_at: string;
  html_url: string;
  assets: ReleaseAsset[];
};

const LOCAL_ADDS = [
  "Device connection over the LAN, with digest auth to the box",
  "Deploy via WS PutCode, in debug or prod mode, min or raw artifact",
  "Live device status, eco toggle and streamed debug logs",
  "The device-profile- and capability-probe-aware lint tiers (the 14 rules the demo skips)",
  "Multi-device and slot selection",
];

export function Download() {
  const [theme, toggleTheme] = useTheme();
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [releaseFailed, setReleaseFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(latestReleaseApiUrl(), {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        return response.json() as Promise<LatestRelease>;
      })
      .then(setRelease)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setReleaseFailed(true);
        }
      });
    return () => controller.abort();
  }, []);

  const assets = release?.assets.filter((asset) => asset.name.endsWith(".zip")) ?? [];

  return (
    <Fragment>
      <SiteHeader theme={theme} toggle={toggleTheme} />

      <main class="site-main">
        <section class="hero hero-download">
          <h1>One file. No Node. Under 5 MB.</h1>
          <p class="hero-sub">
            <code>shellint</code> is a single txiki.js executable — the
            whole server, UI and CLI in one binary, no Node install and no{" "}
            <code>npm install</code> required.
          </p>

        </section>

        <section class="downloads">
          <Group
            title="Latest release"
            id="releases"
            caption={release ? `${release.tag_name} · ${fmtDate(release.published_at)}` : "GitHub"}
          >
            {!release && !releaseFailed ? (
              <p class="release-note" role="status">Loading release assets…</p>
            ) : null}
            {releaseFailed ? (
              <p class="release-note">GitHub release data unavailable.</p>
            ) : null}
            {release ? (
              <table id="downloadTable">
                <thead>
                  <tr>
                    <th>Platform</th>
                    <th>Asset</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset) => (
                    <tr key={asset.name}>
                      <td>{platformLabel(asset.name)}</td>
                      <td><a href={asset.browser_download_url}>{asset.name}</a></td>
                      <td>{fmtBytes(asset.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <p>
              <a href={release?.html_url ?? releasesUrl()} target="_blank" rel="noreferrer">
                All releases on GitHub
              </a>
            </p>
          </Group>
        </section>

        <section class="quickstart">
          <Group title="Quick start" id="quickstart">
            <ol>
              <li>Download the zip for your platform</li>
              <li>
                <code>unzip shellint-macos-arm64.zip</code>
              </li>
              <li>
                <code>./shellint</code>
              </li>
              <li>
                Open <code>http://localhost:8787</code>
              </li>
            </ol>
            <pre class="curl-line">
              <code>curl -fsSL -O {releaseAssetUrl("shellint-macos-arm64.zip")}{"\n"}unzip shellint-macos-arm64.zip{"\n"}./shellint</code>
            </pre>
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
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtDate(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

function platformLabel(asset: string): string {
  const labels: Record<string, string> = {
    "shellint-macos-arm64.zip": "macOS arm64",
    "shellint-linux-x64.zip": "Linux x64",
    "shellint-windows-x64.zip": "Windows x64",
  };
  return labels[asset] ?? asset.replace(/^shellint-/, "").replace(/\.zip$/, "");
}
