#!/usr/bin/env node
import { runProbe } from "./probe.ts";
import { writeGeneratedTypings } from "./probe-typings.ts";

try {
  const report = await runProbe();
  const typings = writeGeneratedTypings();
  console.log(JSON.stringify(report, null, 2));
  console.log(
    `types/generated.d.ts: ${typings.present.length} present, ${typings.absent.length} absent`,
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
