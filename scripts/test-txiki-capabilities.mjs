import { join } from "node:path";
import { ROOT, runTjs } from "./txiki-test-util.mjs";

const probe = join(ROOT, "scripts", "txiki-capability-probe.js");
const result = runTjs(["run", probe]);
const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
const report = JSON.parse(lines.at(-1));

if (report.ok !== true || report.runtime !== "txiki") {
  throw new Error(`invalid capability report: ${JSON.stringify(report)}`);
}

console.log(`txiki capabilities ok (${report.version})`);

