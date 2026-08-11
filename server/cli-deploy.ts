#!/usr/bin/env node
import { deploy, type DeployMinify, type DeployMode } from "./deploy.ts";

function parseArgs(argv: string[]) {
  let mode: DeployMode = "debug";
  let minify: DeployMinify = "min";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode" && argv[i + 1]) {
      mode = argv[++i] === "prod" ? "prod" : "debug";
    } else if (a === "--minify" && argv[i + 1]) {
      minify = argv[++i] === "raw" ? "raw" : "min";
    } else if (a === "prod" || a === "debug") {
      mode = a;
    } else if (a === "raw" || a === "min") {
      minify = a;
    }
  }
  return { mode, minify };
}

const { mode, minify } = parseArgs(process.argv.slice(2));

try {
  const result = await deploy(
    mode,
    (msg) => console.log(`[deploy] ${msg}`),
    minify,
  );
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
