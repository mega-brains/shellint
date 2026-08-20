import type { Page, Route } from "@playwright/test";

/** Fixed clock for log timestamps in screenshots / smoke. */
export const MOCK_TS = 1_700_000_000;
const MOCK_ISO = new Date(MOCK_TS * 1000).toISOString();

export type MockCapture = {
  ver: string | null;
  verKey: string;
  at: string;
  path: string;
  present: number;
  absent: number;
};

/** M16 probe-required gate — see probeState() in server/probe/probe-store.ts. */
export type MockProbeState = {
  required: boolean;
  reason: "never-probed" | "firmware-changed" | "none";
  ver: string | null;
  matched: MockCapture | null;
  newest: MockCapture | null;
  skipped: { ver: string | null; at: string } | null;
  captures: MockCapture[];
};

/** A satisfied state for `ver` — one capture, present-only, nothing skipped. */
function mockProbeState(ver: string): MockProbeState {
  const capture: MockCapture = { ver, verKey: ver, at: MOCK_ISO, path: `mock/${ver}.json`, present: 10, absent: 0 };
  return { required: false, reason: "none", ver, matched: capture, newest: null, skipped: null, captures: [capture] };
}

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
 * Real /api/config, /api/script, /api/stats, /api/checks, build/check stay live
 * — build and check run against the fixture workspace. Check is the one live
 * route that can still reach hardware, because it takes the device's reachable
 * state from the caller; the interception below is what stops it.
 */
export async function mockDeviceApis(page: Page): Promise<void> {
  let logConnected = false;
  let logSeq = 0;

  // The mocked status above reports a device ONLINE, and app.tsx puts that flag
  // straight into the check body — where `connected` means "refresh the device
  // profile over RPC first", i.e. connect to whatever .shellint/devices.json
  // names. A check fires on every page load, so this ran on nearly every spec.
  // Rewrite the flag instead of stubbing the response: probe-required and
  // smoke-panels assert on real check output, so a canned report would make
  // them vacuous. The server refuses `connected` outright when
  // SHELLINT_NO_DEVICE is set (both playwright configs); this keeps a spec that
  // runs against a plain dev server honest too.
  await page.route("**/api/check**", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    await route.continue({ postData: JSON.stringify({ ...body, connected: false }) });
  });

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

  // Default probe state: satisfied, so the M16 probe-required banner stays
  // hidden and Deploy stays enabled for every spec that does not explicitly
  // exercise it (see probe-required.spec.ts for the one that does).
  const probedBadge = (ver: string) => ({ required: false, reason: "none" as const, ver, at: MOCK_ISO });
  const probeStates: Record<string, MockProbeState> = {};

  const mockDevice = {
    id: mockDeviceStatus.device.id,
    label: "e2e-device",
    ip: mockDeviceStatus.deviceIp,
    hasPassword: false,
    info: {
      model: mockDeviceStatus.device.model,
      gen: mockDeviceStatus.device.gen,
      ver: mockDeviceStatus.device.ver,
    },
    slots: { "1": { script: "main" } },
    probe: probedBadge(mockDeviceStatus.device.ver),
  };
  // A second device, only for the device-switch spec — harmless to always
  // list, since nothing selects it unless a test explicitly switches to it.
  const mockDevice2 = {
    id: "shellyplus1pm-second00000",
    label: "Second device",
    ip: "192.168.4.50",
    hasPassword: false,
    info: { model: "SNSW-001P16EU", gen: 2, ver: "1.0.0" },
    slots: { "1": { script: "main" } },
    probe: probedBadge("1.0.0"),
  };
  probeStates[mockDevice.id] = mockProbeState(mockDeviceStatus.device.ver);
  probeStates[mockDevice2.id] = mockProbeState("1.0.0");
  let mockActive = { device: mockDevice.id, slot: 1, script: "main" };

  await page.route("**/api/devices", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await json(route, {
        ok: true,
        devices: [mockDevice, mockDevice2],
        active: mockActive,
      });
      return;
    }
    if (method === "POST") {
      await json(route, { ok: true, device: mockDevice });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/session/active", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = (route.request().postDataJSON() ?? {}) as {
      device?: string;
      slot?: number;
    };
    mockActive = {
      device: body.device ?? mockActive.device,
      slot: body.slot ?? mockActive.slot,
      script: "main",
    };
    // A device switch stops the log stream server-side (debug-log.ts:resetForDeviceSwitch) —
    // mirror that so the next GET/POST /api/device/logs sees a fresh, disconnected stream.
    logConnected = false;
    logSeq = 0;
    const probe = probeStates[mockActive.device] ?? mockProbeState("unknown");
    await json(route, { ok: true, active: mockActive, probe });
  });

  await page.route("**/api/probe/state**", async (route) => {
    const url = new URL(route.request().url());
    const deviceId = url.searchParams.get("device") ?? mockActive.device;
    const state = probeStates[deviceId] ?? mockProbeState("unknown");
    await json(route, { ok: true, ...state });
  });

  await page.route("**/api/probe/skip", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = (route.request().postDataJSON() ?? {}) as { device?: string };
    const deviceId = body.device ?? mockActive.device;
    const current = probeStates[deviceId] ?? mockProbeState("unknown");
    const skipped = { ver: current.ver, at: MOCK_ISO };
    probeStates[deviceId] = { ...current, required: false, skipped };
    await json(route, { ok: true, ...probeStates[deviceId] });
  });

  await page.route("**/api/device/scripts**", async (route) => {
    const url = new URL(route.request().url());
    const forDevice = url.searchParams.get("device") ?? mockActive.device;
    const slots =
      forDevice === mockDevice2.id
        ? [{ id: 1, name: "main", running: false, enable: true, boundScript: "main" }]
        : [
            {
              id: 1,
              name: "main",
              running: mockDeviceStatus.script.running,
              enable: true,
              mem_used: mockDeviceStatus.script.mem_used,
              boundScript: "main",
            },
          ];
    await json(route, { ok: true, slots });
  });

  // Device-side source for `Import code from slot` — deliberately plain ES5
  // JavaScript, which is what a real slot holds.
  await page.route("**/api/device/script/code**", async (route) => {
    const url = new URL(route.request().url());
    const slot = Number(url.searchParams.get("slot") ?? 1);
    const code = 'print("hello from the device slot");\n';
    await json(route, { ok: true, slot, bytes: code.length, code });
  });
}

/**
 * Fixed build sizes / script stats / memory estimate, shared by the
 * `/api/stats` and `/api/history` mocks below so the two stay consistent
 * with each other (e.g. log-call and string-byte totals line up).
 */
export const mockBuildSizes = {
  debug: { raw: 9821, min: 3854, adv: 3708 },
  prod: { raw: 9672, min: 3624, adv: 3624 },
};

export const mockScriptStats = {
  apis: {
    "Shelly.call": 3,
    "Timer.set": 2,
    "BLE.Scanner.Start": 1,
    "HTTPServer.registerEndpoint": 1,
    "Virtual.getHandle": 2,
    print: 3,
  },
  registrations: {
    timers: 2,
    eventHandlers: 1,
    statusHandlers: 1,
    httpEndpoints: 1,
    rpcHandlers: 0,
  },
  declarations: { vars: 67, functions: 11, anonFunctions: 2 },
  literals: { strings: { count: 24, totalBytes: 780 } },
  logging: { consoleLog: 5, print: 2 },
  network: { shellyCall: 0 },
  nesting: { maxAnonymousDepth: 1 },
};

export const mockMemoryEstimate = {
  bytes: 10600,
  breakdown: {
    strings: 2700,
    variables: 2400,
    numbers: 1000,
    functions: 400,
    objects: 300,
    logging: 3800,
  },
};

// Short by design: `.stats-summary` is `white-space: pre-wrap` in a narrow
// sidebar, so a longer reason list wraps onto extra lines and shifts every
// pixel below it (the check-panel baseline scrolls to the sidebar's bottom).
export const mockMinFirmware = {
  version: "1.4.0",
  reasons: [{ api: "Virtual.getHandle", version: "1.1.0" }],
};

/**
 * `/api/stats` and `/api/history` are otherwise left live (see
 * `mockDeviceApis` above) so most e2e specs exercise the real analyzer
 * against the real `scripts/main.ts` fixture. But that fixture is a real,
 * evolving demo script — every edit to it (or every local `mise run build`,
 * which appends to on-disk `.shellint/build-history.jsonl`) shifts the
 * byte counts and memory estimate the dashboard renders, which has nothing
 * to do with layout or styling. Design baselines need those numbers pinned,
 * so this mock makes `/api/stats` + `/api/history` authoritative instead of
 * masking most of the sidebar.
 */
export async function mockBuildApis(page: Page): Promise<void> {
  await page.route("**/api/stats", (route) =>
    json(route, {
      ok: true,
      stats: mockScriptStats,
      variants: null,
      estimate: mockMemoryEstimate,
      minFirmware: mockMinFirmware,
    }),
  );

  await page.route("**/api/history**", (route) =>
    json(route, {
      ok: true,
      history: [
        {
          ts: "2023-11-14T22:00:00.000Z",
          sizes: mockBuildSizes,
          stats: {
            apiCalls: 12,
            consoleLog: mockScriptStats.logging.consoleLog,
            timers: mockScriptStats.registrations.timers,
            anonNest: mockScriptStats.nesting.maxAnonymousDepth,
          },
          memEstimate: mockMemoryEstimate.bytes,
        },
      ],
    }),
  );
}
