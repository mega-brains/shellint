#!/usr/bin/env node
import { runProbe } from "./probe.ts";

try {
  const report = await runProbe();
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
