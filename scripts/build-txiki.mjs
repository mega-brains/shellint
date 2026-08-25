import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./txiki-test-util.mjs";
import { bundleForTxiki } from "./txiki-bundle.mjs";

const outDir = join(ROOT, ".txiki");
mkdirSync(outDir, { recursive: true });

const entries = {
  server: "server/index.txiki.ts",
  deploy: "server/cli/cli-deploy.ts",
  probe: "server/cli/cli-probe.ts",
  profile: "server/cli/cli-profile.ts",
};

// Sequential, not Promise.all: esbuild parallelises inside one build already,
// and four concurrent 6 MB graphs only fight over the same cores while making
// the failure output interleave.
for (const [name, entry] of Object.entries(entries)) {
  const outFile = join(outDir, `${name}.js`);
  await bundleForTxiki(join(ROOT, entry), outFile);
  console.log(`txiki bundle: ${outFile} (${statSync(outFile).size} bytes)`);
}
