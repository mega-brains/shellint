import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, runTjs } from "./txiki-test-util.mjs";

const outDir = join(ROOT, ".txiki");
mkdirSync(outDir, { recursive: true });

const entries = {
  server: "server/index.txiki.ts",
  deploy: "server/cli/cli-deploy.ts",
  probe: "server/cli/cli-probe.ts",
  profile: "server/cli/cli-profile.ts",
};

for (const [name, entry] of Object.entries(entries)) {
  const outFile = join(outDir, `${name}.js`);
  const result = runTjs([
    "bundle",
    "--conditions=txiki",
    "--platform=browser",
    "--define:require=undefined",
    "--define:process=undefined",
    "--define:Buffer=undefined",
    "--target=es2022",
    join(ROOT, entry),
    outFile,
  ]);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  console.log(`txiki bundle: ${outFile}`);
}
