#!/usr/bin/env node
/**
 * Capability probe for the Lightpanda browser as a Playwright CDP target.
 *
 * Investigation tool, not part of any gate. It re-tests, against a live
 * `lightpanda serve`, every claim the 2026-08-18 evaluation made, so a newer
 * nightly can be re-checked in one command instead of by re-reading prose.
 *
 * Usage:
 *   node scripts/lightpanda-probe.mjs [--cdp ws://127.0.0.1:9333]
 *                                     [--app http://127.0.0.1:8850]
 *                                     [--static http://127.0.0.1:8851]
 *
 * Prints one `name: PASS/FAIL/N-A — detail` line per probe and exits non-zero
 * only when the probe harness itself broke, never on a FAIL: a FAIL is data.
 */
import { createHash } from "node:crypto";
import { chromium } from "playwright";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const CDP = arg("cdp", "ws://127.0.0.1:9333");
const APP = arg("app", "http://127.0.0.1:8850");
const STATIC = arg("static", "http://127.0.0.1:8851");

const results = [];
function record(name, verdict, detail) {
  results.push({ name, verdict, detail });
  console.log(`${verdict.padEnd(4)} ${name} — ${detail}`);
}

/**
 * Run one probe, turning a throw into a FAIL with the error's message.
 *
 * The deadline is not belt-and-braces: several unimplemented CDP commands
 * neither answer nor error, so without it the probe wedges instead of
 * reporting — which is itself the finding worth recording.
 */
const DEADLINE_MS = Number(arg("deadline", "45000"));
async function probe(name, fn) {
  const started = Date.now();
  let timer;
  try {
    const guard = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no CDP answer in ${DEADLINE_MS} ms (hang)`)),
        DEADLINE_MS,
      );
    });
    const { verdict = "PASS", detail = "" } = (await Promise.race([fn(), guard])) ?? {};
    record(name, verdict, `${detail} [${Date.now() - started} ms]`);
  } catch (err) {
    record(
      name,
      "FAIL",
      `${String(err?.message ?? err).split("\n")[0].slice(0, 160)} [${Date.now() - started} ms]`,
    );
  } finally {
    clearTimeout(timer);
  }
}

const t0 = Date.now();
const browser = await chromium.connectOverCDP(CDP);
const connectMs = Date.now() - t0;
console.log(`# connected to ${CDP} in ${connectMs} ms`);
console.log(`# lightpanda contexts at connect: ${browser.contexts().length}`);

const context = browser.contexts()[0];
/**
 * Deliberately not `context.pages()[0]`: Lightpanda pre-exposes a stub target
 * (`TID-STARTUP`, `type: "browser"`) that Playwright adopts as a page but that
 * answers `Page.navigate` with an empty result and never commits, so every
 * goto against it stalls for the full timeout. Only a `Target.createTarget`
 * page is navigable — and there is exactly one of those per process.
 */
const page = await context.newPage();

// ------------------------------------------------------------------- the app

await probe("boot the shellint app", async () => {
  await page.goto(`${APP}/`, { waitUntil: "load", timeout: 60_000 });
  const nodes = await page.evaluate(() => document.querySelectorAll("*").length);
  const cm = await page.locator("#editor .cm-content").count();
  const status = await page
    .locator("#statusLine")
    .textContent()
    .catch(() => null);
  return {
    verdict: nodes > 200 && cm > 0 ? "PASS" : "FAIL",
    detail: `${nodes} DOM nodes, .cm-content x${cm}, #statusLine=${JSON.stringify(status)}`,
  };
});

await probe("CodeMirror 6 holds the fixture source", async () => {
  const text = await page
    .locator("#editor .cm-content")
    .innerText()
    .catch(() => "");
  const ok = /shellint test fixture|LOG_PREFIX|Shelly\.call|Timer\.set/.test(text);
  return {
    verdict: ok ? "PASS" : "FAIL",
    detail: `${text.length} chars, fixture markers ${ok ? "present" : "ABSENT"}`,
  };
});

await probe("Web Components / custom elements", async () => {
  const n = await page.evaluate(() => typeof customElements);
  return {
    verdict: n === "object" || n === "function" ? "PASS" : "FAIL",
    detail: `typeof customElements === ${n}`,
  };
});

await probe("localStorage", async () => {
  const v = await page.evaluate(() => {
    localStorage.setItem("lp-probe", "42");
    return localStorage.getItem("lp-probe");
  });
  return { verdict: v === "42" ? "PASS" : "FAIL", detail: `round-tripped ${v}` };
});

await probe("Web Worker (static pipeline.worker.ts)", async () => {
  const v = await page.evaluate(() => typeof Worker);
  return {
    verdict: v === "function" ? "PASS" : "FAIL",
    detail: `typeof Worker === ${v}`,
  };
});

await probe("WebSocket client", async () => {
  const v = await page.evaluate(() => typeof WebSocket);
  return {
    verdict: v === "function" ? "PASS" : "FAIL",
    detail: `typeof WebSocket === ${v}`,
  };
});

await probe("navigator.serviceWorker (offline boot spec)", async () => {
  const v = await page.evaluate(() => typeof navigator.serviceWorker);
  return {
    verdict: v === "object" ? "PASS" : "FAIL",
    detail: `typeof navigator.serviceWorker === ${v}`,
  };
});

// -------------------------------------------------------------------- layout

await probe("getBoundingClientRect on <body> is plausible", async () => {
  const r = await page.evaluate(() => {
    const b = document.body.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  // The archived finding: x == y for every element, height 1e8.
  const faux = r.x === r.y || r.h > 1e6;
  return {
    verdict: faux ? "FAIL" : "PASS",
    detail: `body rect ${JSON.stringify(r)}${faux ? " — faux layout signature" : ""}`,
  };
});

await probe("locator.boundingBox on header is non-zero", async () => {
  const box = await page.locator("header.top").boundingBox();
  const zero = !box || (box.width === 0 && box.height === 0);
  return {
    verdict: zero ? "FAIL" : "PASS",
    detail: `header box ${JSON.stringify(box)}`,
  };
});

await probe("distinct elements get distinct rects", async () => {
  const rects = await page.evaluate(() =>
    ["header.top", "#workspace", "#side", "#dock"].map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return `${sel}:missing`;
      const r = el.getBoundingClientRect();
      return `${sel}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`;
    }),
  );
  const unique = new Set(rects.map((r) => r.split(":")[1])).size;
  return {
    verdict: unique >= 3 ? "PASS" : "FAIL",
    detail: `${unique} distinct of ${rects.length}: ${rects.join(" | ")}`,
  };
});

await probe("getComputedStyle sees CSS custom properties", async () => {
  const v = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
  );
  return {
    verdict: v ? "PASS" : "FAIL",
    detail: `--bg = ${JSON.stringify(v)}`,
  };
});

await probe("elementFromPoint (design.spec hit-testing)", async () => {
  const v = await page.evaluate(() => {
    const el = document.elementFromPoint(700, 30);
    return el ? (el.id || el.className || el.tagName) : null;
  });
  return {
    verdict: v ? "PASS" : "FAIL",
    detail: `elementFromPoint(700,30) = ${JSON.stringify(v)}`,
  };
});

// ---------------------------------------------------------------- screenshot

await probe("Page.captureScreenshot differs per page", async () => {
  const a = await page.screenshot();
  const ha = createHash("sha256").update(a).digest("hex");
  await page.goto(`${STATIC}/`, { waitUntil: "load", timeout: 60_000 });
  const b = await page.screenshot();
  const hb = createHash("sha256").update(b).digest("hex");
  const same = ha === hb;
  return {
    verdict: same ? "FAIL" : "PASS",
    detail: same
      ? `IDENTICAL bytes for two different pages: ${a.length} B, sha256 ${ha.slice(0, 16)}… (hardcoded PNG)`
      : `app ${a.length} B ${ha.slice(0, 12)} vs site ${b.length} B ${hb.slice(0, 12)}`,
  };
});

// ------------------------------------------------------------------ emulation

await probe("Emulation.setEmulatedMedia / colorScheme", async () => {
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await page.evaluate(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  await page.emulateMedia({ colorScheme: "light" });
  const light = await page.evaluate(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  return {
    verdict: dark && !light ? "PASS" : "FAIL",
    detail: `dark→${dark}, light→${light}${dark === light ? " — setEmulatedMedia is a no-op" : ""}`,
  };
});

await probe("setViewportSize (breakpoint specs)", async () => {
  await page.setViewportSize({ width: 900, height: 700 });
  const w = await page.evaluate(() => innerWidth);
  return {
    verdict: w === 900 ? "PASS" : "FAIL",
    detail: `asked 900, innerWidth = ${w}`,
  };
});

// ---------------------------------------------------------- static build path

await probe("boot the static /demo/ build", async () => {
  await page.goto(`${STATIC}/demo/`, { waitUntil: "load", timeout: 60_000 });
  const cm = await page.locator("#editor .cm-content").count();
  const status = await page
    .locator("#statusLine")
    .textContent()
    .catch(() => null);
  return {
    verdict: cm > 0 ? "PASS" : "FAIL",
    detail: `.cm-content x${cm}, #statusLine=${JSON.stringify(status)}`,
  };
});

await probe("setInputFiles (static open-file path)", async () => {
  await page.setInputFiles("#staticOpenFile", {
    name: "probe.js",
    mimeType: "text/plain",
    buffer: Buffer.from("var GREETING = 'lp-probe';\n"),
  });
  const txt = await page.locator("#statusLine").textContent();
  return {
    verdict: /opened probe\.js/.test(txt ?? "") ? "PASS" : "FAIL",
    detail: `#statusLine = ${JSON.stringify(txt)}`,
  };
});

// ------------------------------------------------------------------ interaction

await probe("toBeVisible on a real element", async () => {
  await page.goto(`${APP}/`, { waitUntil: "load", timeout: 60_000 });
  const vis = await page.getByTestId("tab-check").isVisible();
  return {
    verdict: vis ? "PASS" : "FAIL",
    detail: `locator.isVisible() = ${vis}${vis ? "" : " — zero-size box fails Playwright's visibility test"}`,
  };
});

await probe("locator.click (actionability path)", async () => {
  await page.getByTestId("tab-check").click({ timeout: 10_000 });
  const sel = await page.getByTestId("tab-check").getAttribute("aria-selected");
  return {
    verdict: sel === "true" ? "PASS" : "FAIL",
    detail: `tab-check aria-selected = ${sel}`,
  };
});

await probe("locator.click({force:true}) (skips actionability)", async () => {
  await page.getByTestId("tab-options").click({ force: true, timeout: 10_000 });
  const sel = await page.getByTestId("tab-options").getAttribute("aria-selected");
  return {
    verdict: sel === "true" ? "PASS" : "FAIL",
    detail: `tab-options aria-selected = ${sel}`,
  };
});

await probe("dispatchEvent click (no layout at all)", async () => {
  await page.getByTestId("tab-build").dispatchEvent("click", {}, { timeout: 10_000 });
  const sel = await page.getByTestId("tab-build").getAttribute("aria-selected");
  return {
    verdict: sel === "true" ? "PASS" : "FAIL",
    detail: `tab-build aria-selected = ${sel}`,
  };
});

await probe("page.route interception", async () => {
  let hit = false;
  await page.route("**/api/config**", async (route) => {
    hit = true;
    await route.fallback();
  });
  await page.goto(`${APP}/`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.unroute("**/api/config**");
  return { verdict: hit ? "PASS" : "FAIL", detail: `handler fired: ${hit}` };
});

// ------------------------------------------------------------------ structural
// Last on purpose, and in this order: each of the three wedges the CDP session
// for good, so anything after them reports a hang regardless of its own merit.
// Measured, not defensive — see the report.

await probe("context.newPage (parallel workers)", async () => {
  const p = await context.newPage();
  await p.close();
  return { detail: "a second page opened — worker parallelism possible" };
});

await probe("browser.newContext (per-test isolation)", async () => {
  const c = await browser.newContext();
  await c.close();
  return { detail: "a second context opened — per-test isolation possible" };
});

await probe("goto about:blank (cheap per-test reset)", async () => {
  await page.goto("about:blank", { timeout: 20_000 });
  return { detail: "navigated" };
});

console.log("\n# summary");
const pass = results.filter((r) => r.verdict === "PASS").length;
const fail = results.filter((r) => r.verdict === "FAIL").length;
console.log(`# ${pass} pass, ${fail} fail of ${results.length} probes`);
for (const r of results.filter((x) => x.verdict === "FAIL")) {
  console.log(`#   FAIL ${r.name}`);
}

await browser.close().catch(() => {});
