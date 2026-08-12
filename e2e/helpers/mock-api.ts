import type { Page, Route } from "@playwright/test";

/** Fixed clock for log timestamps in screenshots / smoke. */
export const MOCK_TS = 1_700_000_000;

export const mockDeviceStatus = {
  deviceIp: "192.168.3.106",
  scriptId: 1,
  latencyMs: 12,
  device: {
    id: "shellypro4pm-aabbccddeeff",
    name: "e2e-device",
    model: "SPSW-004PE16EU",
    gen: 2,
    ver: "1.4.0",
    chip: "ESP32",
    chipInferred: true as const,
  },
  script: {
    id: 1,
    name: "main",
    running: true,
    mem_used: 12_288,
    mem_peak: 16_384,
    mem_free: 40_960,
    cpu: 18,
    errors: [] as unknown[],
  },
  sys: {
    ram_size: 262_144,
    ram_free: 120_000,
    ram_min_free: 80_000,
    fs_size: 524_288,
    fs_free: 300_000,
    uptime: 86_400,
    restart_required: false,
    unixtime: MOCK_TS,
  },
  eco_mode: false,
  temperatureC: 42.5,
  temperatureFrom: "switch:0",
  wifi: {
    rssi: -55,
    ssid: "e2e-wifi",
    sta_ip: "192.168.3.106",
  },
};

const mockLogLines = [
  { seq: 1, ts: MOCK_TS, level: 2, text: "boot complete" },
  { seq: 2, ts: MOCK_TS + 1, level: 2, text: "#m cpu 18" },
  { seq: 3, ts: MOCK_TS + 2, level: 2, text: "poll ok" },
];

const mockMetrics = [
  { ts: MOCK_TS + 1, series: "cpu", value: 18 },
];

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/**
 * Intercept device/probe APIs so e2e never needs Shelly hardware.
 * Real /api/config, /api/script, /api/stats, /api/checks, build/check stay live.
 */
export async function mockDeviceApis(page: Page): Promise<void> {
  let logConnected = false;
  let logSeq = 0;

  await page.route("**/api/device/status", (route) =>
    json(route, { ok: true, status: mockDeviceStatus }),
  );

  await page.route("**/api/device/eco", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { eco_mode?: boolean };
    mockDeviceStatus.eco_mode = !!body.eco_mode;
    await json(route, { ok: true, eco_mode: mockDeviceStatus.eco_mode });
  });

  await page.route("**/api/device/script", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { running?: boolean };
    mockDeviceStatus.script.running = !!body.running;
    await json(route, {
      ok: true,
      running: mockDeviceStatus.script.running,
      scriptId: mockDeviceStatus.scriptId,
    });
  });

  await page.route("**/api/device/reboot", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await json(route, { ok: true });
  });

  await page.route("**/api/device/logs**", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const body = (route.request().postDataJSON() ?? {}) as { action?: string };
      if (body.action === "stop") {
        logConnected = false;
        await json(route, { ok: true, connected: false });
        return;
      }
      logConnected = true;
      logSeq = 0;
      await json(route, {
        ok: true,
        connected: true,
        enabledDebug: true,
        restartRequired: false,
      });
      return;
    }

    const url = new URL(route.request().url());
    const since = Number(url.searchParams.get("since") ?? "0") || 0;
    if (!logConnected) {
      await json(route, {
        ok: true,
        stream: {
          connected: false,
          seq: logSeq,
          dropped: 0,
          lines: [],
          metrics: [],
        },
      });
      return;
    }
    const lines = since === 0 ? mockLogLines : [];
    const metrics = since === 0 ? mockMetrics : [];
    if (lines.length) logSeq = lines[lines.length - 1]!.seq;
    await json(route, {
      ok: true,
      stream: {
        connected: true,
        seq: logSeq,
        dropped: 0,
        lines,
        metrics,
      },
    });
  });

  await page.route("**/api/probe/progress", (route) =>
    json(route, { ok: true, done: 0, total: 0 }),
  );

  await page.route("**/api/probe", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await json(route, {
      ok: true,
      report: {
        scriptId: 1,
        strategy: "e2e-mock",
        notes: ["mocked"],
        results: [{ id: "Timer.set", ok: true, result: true }],
      },
      typings: { path: "types/generated.d.ts", bytes: 0 },
    });
  });
}
