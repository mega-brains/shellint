import { el } from "./dom-refs";
import { closeAllMenus } from "./split-button";

export type ProbeResult = { id: string; ok: boolean; result?: unknown; error?: string };

let lastProbeResults: ProbeResult[] = [];
let probeLogFailOnly = false;

/** RPC succeeded but the probed feature reads back as absent — not a pass. */
export function probeAvailable(r: ProbeResult): boolean {
  if (!r.ok || r.result == null || r.result === "undefined" || r.result === "null" || r.result === "unavailable") return false;
  return !(typeof r.result === "string" && r.result.startsWith("throws:"));
}

export function renderProbeLogList() {
  const q = el.probeLogFilter.value.trim().toLowerCase();
  let shown = q ? lastProbeResults.filter((r) => r.id.toLowerCase().includes(q)) : lastProbeResults;
  if (probeLogFailOnly) shown = shown.filter((r) => !probeAvailable(r));
  el.probeLogList.innerHTML = "";
  for (const r of shown) {
    const li = document.createElement("li");
    li.className = probeAvailable(r) ? "ok" : "fail";
    const id = document.createElement("span");
    id.className = "probe-log-id";
    id.textContent = r.id;
    const val = document.createElement("span");
    val.className = "probe-log-val";
    val.textContent = r.ok ? JSON.stringify(r.result) : `FAIL ${r.error}`;
    li.append(id, val);
    el.probeLogList.append(li);
  }
}

export function renderProbeLog(scriptId: number, strategy: string, results: ProbeResult[]) {
  lastProbeResults = results;
  const passed = results.filter(probeAvailable).length;
  el.probeLogNote.textContent =
    `slot ${scriptId} (${strategy}) · ${passed}/${results.length} available`;
  renderProbeLogList();
}

export function closeProbeLog() {
  el.probeLog.hidden = true;
  el.probeLogToggle.setAttribute("aria-expanded", "false");
}

export function setProbeProgress(done: number, total: number, setStatus: (msg: string) => void) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  el.probeProgressFill.style.width = `${pct}%`;
  setStatus(total > 0 ? `probing… ${done}/${total} (${pct}%)` : "probing…");
}

export function toggleProbeLogFailOnly() {
  probeLogFailOnly = !probeLogFailOnly;
  el.probeLogFailBtn.setAttribute("aria-pressed", probeLogFailOnly ? "true" : "false");
  renderProbeLogList();
}

export function wireProbeLogToggle() {
  el.probeLogToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = el.probeLog.hidden;
    closeAllMenus();
    if (willOpen) {
      el.probeLog.hidden = false;
      el.probeLogToggle.setAttribute("aria-expanded", "true");
    } else {
      closeProbeLog();
    }
  });
  document.addEventListener("click", (e) => {
    if (!el.probeSplit.contains(e.target as Node)) closeProbeLog();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeProbeLog();
  });
  el.probeLogFilter.addEventListener("input", () => renderProbeLogList());
  el.probeLogFailBtn.addEventListener("click", toggleProbeLogFailOnly);
}
