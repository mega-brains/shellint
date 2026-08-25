import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runTjs } from "./txiki-test-util.mjs";
import { bundleForTxiki } from "./txiki-bundle.mjs";

function runNode(entry) {
  const result = spawnSync(process.execPath, [entry], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Node condition proof failed\n${result.stdout}${result.stderr}`);
  }
  return result.stdout.trim();
}

const dir = mkdtempSync(join(tmpdir(), "shellint-txiki-conditions-"));
try {
  const entry = join(dir, "entry.js");
  const bundle = join(dir, "entry.bundle.js");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      type: "module",
      imports: {
        "#proof/runtime": {
          txiki: "./runtime.txiki.js",
          default: "./runtime.node.js",
        },
      },
    }),
  );
  writeFileSync(join(dir, "runtime.node.js"), 'export const runtime = "node";\n');
  writeFileSync(join(dir, "runtime.txiki.js"), 'export const runtime = "txiki";\n');
  writeFileSync(entry, 'import { runtime } from "#proof/runtime";\nconsole.log(runtime);\n');

  const nodeRuntime = runNode(entry);
  if (nodeRuntime !== "node") {
    throw new Error(`default condition selected ${nodeRuntime}, expected node`);
  }

  // The proof fixture is plain ESM with no `tjs:` imports, so the production
  // define/target set would only add noise — `conditions` is the thing on trial.
  await bundleForTxiki(entry, bundle, {
    minifyIdentifiers: false,
    minifySyntax: false,
    define: {},
  });
  const bundleText = readFileSync(bundle, "utf8");
  if (bundleText.includes('runtime = "node"')) {
    throw new Error("txiki bundle retained default runtime implementation");
  }
  const txikiRuntime = runTjs(["run", bundle]).stdout.trim();
  if (txikiRuntime !== "txiki") {
    throw new Error(`txiki condition selected ${txikiRuntime}, expected txiki`);
  }

  console.log("conditional imports ok (node default, txiki condition)");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
