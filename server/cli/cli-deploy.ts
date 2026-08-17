#!/usr/bin/env node
import runtime from "#devroom/runtime";
import { deploy, type DeployMinify, type DeployMode } from "../device/deploy.ts";

function parseArgs(argv: string[]) {
  let mode: DeployMode = "debug";
  let minify: DeployMinify = "min";
  let skipProbeCheck = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode" && argv[i + 1]) {
      mode = argv[++i] === "prod" ? "prod" : "debug";
    } else if (a === "--minify" && argv[i + 1]) {
      minify = argv[++i] === "raw" ? "raw" : "min";
    } else if (a === "--no-probe-check") {
      skipProbeCheck = true;
    } else if (a === "prod" || a === "debug") {
      mode = a;
    } else if (a === "raw" || a === "min") {
      minify = a;
    }
  }
  return { mode, minify, skipProbeCheck };
}

const { mode, minify, skipProbeCheck } = parseArgs(runtime.process.args.slice(2));

try {
  const result = await deploy(
    mode,
    (msg) => console.log(`[deploy] ${msg}`),
    minify,
    { skipProbeCheck },
  );
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  runtime.process.exit(1);
}
