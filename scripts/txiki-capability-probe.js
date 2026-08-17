const requiredFunctions = {
  "tjs.serve": tjs.serve,
  "tjs.readFile": tjs.readFile,
  "tjs.writeFile": tjs.writeFile,
  "tjs.spawn": tjs.spawn,
  fetch: globalThis.fetch,
  WebSocket: globalThis.WebSocket,
  ReadableStream: globalThis.ReadableStream,
};

const checks = Object.fromEntries(
  Object.entries(requiredFunctions).map(([name, value]) => [name, typeof value === "function"]),
);
checks["tjs.engine.features.tls"] = tjs.engine?.features?.tls === true;
checks["tjs.engine.features.webcrypto"] = tjs.engine?.features?.webcrypto === true;

try {
  const [{ createHash }, pathModule] = await Promise.all([
    import("tjs:hashing"),
    import("tjs:path"),
  ]);
  const path = pathModule.default;
  checks["tjs:hashing"] =
    createHash("sha256").update("abc").digest() ===
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  const joined = path.join("devroom", "probe");
  checks["tjs:path"] = path.basename(joined) === "probe" &&
    path.basename(path.dirname(joined)) === "devroom";
} catch {
  checks["tjs:hashing"] = false;
  checks["tjs:path"] = false;
}

const missing = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);
const report = {
  ok: missing.length === 0,
  runtime: "txiki",
  version: tjs.version,
  checks,
  missing,
};

console.log(JSON.stringify(report));
if (missing.length > 0) {
  throw new Error(`txiki.js lacks required capabilities: ${missing.join(", ")}`);
}
