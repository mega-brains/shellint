/** Streamed Check route and browser parser smoke. */
import assert from "node:assert/strict";
import { createApp } from "../server/app.ts";
import {
  CHECK_PROGRESS_STEPS,
  CHECK_PROGRESS_TOTAL,
} from "../server/lint/check.ts";
import { apiStream } from "../web/lib/api.ts";

const app = createApp();
const body = JSON.stringify({ connected: false });
const normalResponse = await app.request("/api/check", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});
assert.equal(normalResponse.status, 200, "plain Check route failed");
const normal = await normalResponse.json();

const streamResponse = await app.request("/api/check/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});
assert.equal(streamResponse.status, 200, "stream Check route failed");
assert.match(
  streamResponse.headers.get("Content-Type") ?? "",
  /^application\/x-ndjson/,
  "stream Check route needs NDJSON content type",
);
const events = (await streamResponse.text())
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const progress = events.filter((event) => event.type === "progress");
assert.deepEqual(
  progress.map((event) => event.done),
  CHECK_PROGRESS_STEPS,
  "stream Check progress milestones changed",
);
assert.ok(
  progress.every((event) => event.total === CHECK_PROGRESS_TOTAL),
  "stream Check progress total changed",
);
assert.equal(
  CHECK_PROGRESS_STEPS.at(-1),
  CHECK_PROGRESS_TOTAL,
  "progress milestones no longer cover catalog",
);
const report = events.at(-1);
assert.equal(report.type, "report", "stream Check needs final report");
assert.deepEqual(report.report, normal.report, "stream Check report diverged");

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () =>
    new Response(
      '{"type":"progress","done":0,"total":1}\n' +
        '{"type":"report","report":{"complete":true}}\n',
    );
  const received = [];
  const parsed = await apiStream("/api/check/stream", undefined, (event) => {
    received.push(event);
  });
  assert.deepEqual(received, [{ done: 0, total: 1 }], "parser lost progress");
  assert.deepEqual(parsed, { complete: true }, "parser lost final report");

  globalThis.fetch = async () =>
    new Response('{"type":"error","error":"stream broke"}\n');
  await assert.rejects(
    () => apiStream("/api/check/stream", undefined, () => {}),
    /stream broke/,
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("OK: streamed Check route and parser");
