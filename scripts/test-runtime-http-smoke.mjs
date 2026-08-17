import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, resolveTjsBin } from "./txiki-test-util.mjs";

function parseArgs(argv) {
  const out = {
    runtime: "node",
    url: process.env.DEVROOM_SMOKE_URL ?? "http://127.0.0.1:8787",
    bundle: resolve(ROOT, ".txiki", "server.js"),
    timeoutMs: 20_000,
    spawn: true,
    report: null,
    compare: null,
    command: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      out.command = argv.slice(i + 1);
      break;
    }
    if (arg === "--runtime") out.runtime = argv[++i];
    else if (arg === "--url") out.url = argv[++i];
    else if (arg === "--bundle") out.bundle = resolve(argv[++i]);
    else if (arg === "--timeout") out.timeoutMs = Number(argv[++i]);
    else if (arg === "--report") out.report = resolve(argv[++i]);
    else if (arg === "--compare") out.compare = resolve(argv[++i]);
    else if (arg === "--no-spawn") out.spawn = false;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!new Set(["node", "txiki"]).has(out.runtime)) {
    throw new Error("--runtime must be node or txiki");
  }
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) {
    throw new Error("--timeout must be positive milliseconds");
  }
  return out;
}

function serverCommand(options) {
  if (options.command?.length) {
    const command = [...options.command];
    if (options.runtime === "txiki") {
      if (command[0] !== "tjs" && command[0] !== "{tjs}") {
        throw new Error("txiki command override must begin with tjs or {tjs}");
      }
      command[0] = resolveTjsBin();
    }
    return command;
  }
  if (options.runtime === "txiki") {
    if (!existsSync(options.bundle)) {
      throw new Error(`txiki server bundle missing: ${options.bundle}`);
    }
    return [resolveTjsBin(), "run", options.bundle];
  }
  return [process.execPath, "--import", "tsx", resolve(ROOT, "server", "index.ts")];
}

function appendBounded(current, chunk) {
  const next = current + chunk.toString();
  return next.length > 64_000 ? next.slice(-64_000) : next;
}

function startServer(options) {
  const command = serverCommand(options);
  const child = spawn(command[0], command.slice(1), {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = { stdout: "", stderr: "", error: null };
  child.stdout.on("data", (chunk) => { state.stdout = appendBounded(state.stdout, chunk); });
  child.stderr.on("data", (chunk) => { state.stderr = appendBounded(state.stderr, chunk); });
  child.on("error", (error) => { state.error = error; });
  return { child, command, state };
}

async function waitReady(url, processState, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "server not ready";
  while (Date.now() < deadline) {
    if (processState?.state.error) throw processState.state.error;
    if (processState?.child.exitCode != null) {
      throw new Error(
        `server exited ${processState.child.exitCode}\n${processState.state.stdout}${processState.state.stderr}`,
      );
    }
    try {
      const response = await fetch(new URL("/api/config", url));
      if (response.ok) return;
      lastError = `readiness returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`server readiness timed out: ${lastError}`);
}

const CASES = [
  { path: "/", accept: "text/html", encoding: "identity" },
  { path: "/app.js", accept: "application/javascript", encoding: "br, gzip" },
  { path: "/styles.css", accept: "text/css", encoding: "br, gzip" },
  { path: "/api-docs.json", accept: "application/json", encoding: "br, gzip" },
  { path: "/api/config", accept: "application/json", encoding: "identity" },
  { path: "/api/script", accept: "application/json", encoding: "identity" },
  { path: "/api/checks", accept: "application/json", encoding: "identity" },
  { path: "/api/artifacts", accept: "application/json", encoding: "identity" },
];

async function probe(baseUrl, item) {
  const response = await fetch(new URL(item.path, baseUrl), {
    headers: {
      Accept: item.accept,
      "Accept-Encoding": item.encoding,
    },
  });
  const body = new Uint8Array(await response.arrayBuffer());
  const result = {
    path: item.path,
    status: response.status,
    contentType: response.headers.get("content-type"),
    contentEncoding: response.headers.get("content-encoding"),
    vary: response.headers.get("vary"),
    bytes: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
  if (response.status !== 200) {
    throw new Error(`${item.path} returned ${response.status}`);
  }
  return result;
}

async function stopServer(processState) {
  if (!processState || processState.child.exitCode != null) return;
  processState.child.kill("SIGTERM");
  const exited = new Promise((resolveExit) => processState.child.once("exit", resolveExit));
  const timedOut = new Promise((resolveWait) => setTimeout(() => resolveWait("timeout"), 2_000));
  if (await Promise.race([exited, timedOut]) === "timeout") {
    processState.child.kill("SIGKILL");
    await exited;
  }
}

const options = parseArgs(process.argv.slice(2));
let processState = null;
try {
  if (options.spawn) processState = startServer(options);
  await waitReady(options.url, processState, options.timeoutMs);
  const results = [];
  for (const item of CASES) results.push(await probe(options.url, item));
  const report = { runtime: options.runtime, results };

  if (options.compare) {
    const baseline = JSON.parse(readFileSync(options.compare, "utf8"));
    if (JSON.stringify(baseline.results) !== JSON.stringify(results)) {
      throw new Error(`HTTP smoke differs from ${options.compare}`);
    }
  }
  if (options.report) writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await stopServer(processState);
}
