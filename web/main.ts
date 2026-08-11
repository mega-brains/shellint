import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";

const el = {
  editor: document.getElementById("editor")!,
  save: document.getElementById("btnSave") as HTMLButtonElement,
  build: document.getElementById("btnBuild") as HTMLButtonElement,
  deploy: document.getElementById("btnDeploy") as HTMLButtonElement,
  probe: document.getElementById("btnProbe") as HTMLButtonElement,
  mode: document.getElementById("modeSelect") as HTMLSelectElement,
  minify: document.getElementById("minifySelect") as HTMLSelectElement,
  status: document.getElementById("statusLine")!,
  sizeDebug: document.getElementById("sizeDebug")!,
  sizeProd: document.getElementById("sizeProd")!,
  configLine: document.getElementById("configLine")!,
};

function setStatus(msg: string, isError = false) {
  el.status.textContent = msg;
  el.status.classList.toggle("error", isError);
}

function formatSizes(pair: { raw?: number; min?: number } | undefined): string {
  if (!pair) return "—";
  const parts: string[] = [];
  if (pair.raw != null) parts.push(`raw ${pair.raw} B`);
  if (pair.min != null) parts.push(`min ${pair.min} B`);
  return parts.length ? parts.join(" · ") : "—";
}

async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const data = (await res.json()) as T & { ok: boolean; error?: string };
  if (res.status === 401 || data.error === "auth not supported yet") {
    throw new Error("auth not supported yet");
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

let view: EditorView;

async function loadScript() {
  const data = await api<{ source: string }>("/api/script");
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: data.source },
  });
  setStatus("loaded scripts/main.ts");
}

async function saveScript() {
  const source = view.state.doc.toString();
  await api("/api/script", {
    method: "PUT",
    body: JSON.stringify({ source }),
  });
  setStatus(`saved (${new TextEncoder().encode(source).length} B)`);
}

async function buildScript() {
  setStatus("building…");
  const data = await api<{
    sizes: { debug: { raw?: number; min?: number }; prod: { raw?: number; min?: number } };
  }>("/api/build", { method: "POST", body: "{}" });
  el.sizeDebug.textContent = formatSizes(data.sizes.debug);
  el.sizeProd.textContent = formatSizes(data.sizes.prod);
  setStatus("build ok");
}

async function deployScript() {
  const mode = el.mode.value;
  const minify = el.minify.value === "raw" ? "raw" : "min";
  const label = minify === "raw" ? "non-minified" : "minified";
  setStatus(`deploy ${mode}/${label}: connecting…`);
  const data = await api<{
    localBytes: number;
    deviceLen: number | null;
    status: string;
    scriptId: number;
    minify: string;
  }>("/api/deploy", {
    method: "POST",
    body: JSON.stringify({ mode, minify }),
  });
  const len =
    data.deviceLen != null
      ? `device len ${data.deviceLen} (local ${data.localBytes})`
      : `local ${data.localBytes} B`;
  setStatus(
    `deploy ${mode}/${label}: ${data.status} · scriptId ${data.scriptId} · ${len}`,
  );
}

async function probeDevice() {
  setStatus("probing…");
  const data = await api<{
    report: { results: { id: string; ok: boolean; result?: unknown; error?: string }[] };
  }>("/api/probe", { method: "POST", body: "{}" });
  const lines = data.report.results.map((r) => {
    if (r.ok) return `${r.id}: ${JSON.stringify(r.result)}`;
    return `${r.id}: FAIL ${r.error}`;
  });
  setStatus(`probe written to types/generated-probe.json\n${lines.join("\n")}`);
}

function busy(on: boolean) {
  for (const b of [el.save, el.build, el.deploy, el.probe]) b.disabled = on;
  el.mode.disabled = on;
  el.minify.disabled = on;
}

async function withBusy(fn: () => Promise<void>) {
  busy(true);
  try {
    await fn();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    busy(false);
  }
}

async function main() {
  view = new EditorView({
    state: EditorState.create({
      doc: "// loading…\n",
      extensions: [basicSetup, javascript({ typescript: true }), EditorView.lineWrapping],
    }),
    parent: el.editor,
  });

  try {
    const cfg = await api<{
      config: { deviceIp: string; scriptId: number; host: string; port: number; compiler: string };
    }>("/api/config");
    const c = cfg.config;
    el.configLine.textContent = `${c.deviceIp} · script ${c.scriptId} · ${c.host}:${c.port} · ${c.compiler}`;
  } catch {
    el.configLine.textContent = "config unavailable";
  }

  el.save.addEventListener("click", () => withBusy(saveScript));
  el.build.addEventListener("click", () => withBusy(buildScript));
  el.deploy.addEventListener("click", () => withBusy(deployScript));
  el.probe.addEventListener("click", () => withBusy(probeDevice));

  await withBusy(loadScript);
}

main();
