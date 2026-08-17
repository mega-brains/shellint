import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, resolveTjsBin, runTjs } from "./txiki-test-util.mjs";

const name = process.argv[2];
if (!name || !/^[a-z-]+$/.test(name)) {
  throw new Error("usage: node scripts/run-txiki.mjs <bundle> [args]");
}

const bundle = join(ROOT, ".txiki", `${name}.js`);
if (!existsSync(bundle)) {
  throw new Error(`txiki bundle missing: ${bundle}; run npm run build:txiki`);
}

runTjs(["run", join(ROOT, "scripts", "txiki-capability-probe.js")]);

const result = spawnSync(resolveTjsBin(), ["run", bundle, ...process.argv.slice(3)], {
  cwd: ROOT,
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
