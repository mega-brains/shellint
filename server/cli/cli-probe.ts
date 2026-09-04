#!/usr/bin/env node
import runtime from "#shellint/runtime";
import { runProbe } from "../probe/probe.ts";
import { writeGeneratedTypings } from "../probe/probe-typings.ts";
import { resolveCapture } from "../probe/probe-store.ts";
import { requireActive } from "../device/devices.ts";

try {
  const report = await runProbe();
  const typings = await writeGeneratedTypings();
  console.log(JSON.stringify(report, null, 2));
  console.log(
    `types/generated.d.ts: ${typings.present.length} present, ${typings.absent.length} absent, ${report.unevaluated ?? 0} unevaluated`,
  );
  const capture = await resolveCapture((await requireActive()).device.id, report.ver);
  if (capture) {
    console.log(`capture: ${capture.path} (fw ${capture.ver ?? "unknown"})`);
  }
  if (report.unevaluated) runtime.process.exit(1);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  runtime.process.exit(1);
}
