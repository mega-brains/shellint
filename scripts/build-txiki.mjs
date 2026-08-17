import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, resolveTjsBundleBin, runTjs } from "./txiki-test-util.mjs";

const outDir = join(ROOT, ".txiki");
mkdirSync(outDir, { recursive: true });

const entries = {
  server: "server/index.txiki.ts",
  deploy: "server/cli/cli-deploy.ts",
  probe: "server/cli/cli-probe.ts",
  profile: "server/cli/cli-profile.ts",
};

const bundleBin = resolveTjsBundleBin();

for (const [name, entry] of Object.entries(entries)) {
  const outFile = join(outDir, `${name}.js`);
  const result = runTjs([
    "bundle",
    // Deliberately NOT `--minify`: that implies `--minify-whitespace`, which
    // collapses the bundle onto one line, and QuickJS's parser is superlinear
    // in line length. Measured on the 4.5 MB server bundle: `tjs run` spends
    // ~29 s parsing before the first statement executes (whitespace-only
    // minify is worse still, ~147 s), against ~0.4 s for the two flags below.
    // The `tjs compile` executable is unaffected either way — it ships
    // bytecode — and is in fact 59 KB *smaller* built from this output.
    "--minify-identifiers",
    "--minify-syntax",
    "--conditions=txiki",
    "--platform=browser",
    "--define:require=undefined",
    "--define:process=undefined",
    "--define:Buffer=undefined",
    "--target=es2022",
    join(ROOT, entry),
    outFile,
  ], { bin: bundleBin });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  console.log(`txiki bundle: ${outFile}`);
}
