/**
 * Load-from-disk / save-to-disk / download-artifacts for the static build
 * (M17.6). Pure DOM + File System Access API logic, no Preact — the wiring
 * component is `web/shell/static-file-controls.tsx`.
 *
 * Deliberately independent of `web/static/local-api.ts`: everything here
 * talks to the caller-supplied `api()` (the same seam every other UI module
 * uses — `web/lib/api.ts` in server mode, `local-api.ts` in static mode), so
 * this file never imports a static-only module directly. That matters
 * because `web/shell/static-file-controls.tsx` is wired from app.tsx/
 * toolbar.tsx, which are shared with the server build — a direct import of
 * local-api.ts's internals from there would drag its module graph into the
 * server's web/dist/app.js too (see scripts/static-esbuild.mjs's header on
 * why the `../lib/api` alias is the *only* sanctioned door into local-api.ts).
 *
 * `showOpenFilePicker` has no ambient type in this TypeScript's lib.dom.d.ts
 * (the rest of the File System Access API — FileSystemFileHandle,
 * FileSystemWritableFileStream — does), so it's declared locally and
 * feature-detected at runtime; Firefox/Safari fall back to the always-legal
 * `<input type="file">` + Blob-download path.
 */

declare global {
  interface FilePickerAcceptType {
    description?: string;
    accept: Record<string, string | string[]>;
  }
  interface OpenFilePickerOptions {
    types?: FilePickerAcceptType[];
    excludeAcceptAllOption?: boolean;
    multiple?: boolean;
  }
  interface Window {
    showOpenFilePicker?: (
      options?: OpenFilePickerOptions,
    ) => Promise<FileSystemFileHandle[]>;
  }
}

export type DeviceSourceKind = "ts" | "js";

export type OpenedFile = {
  name: string;
  text: string;
  kind: DeviceSourceKind;
  /** Present only via `openFilePicker()` — `<input>`/drag-drop hand back a plain `File`. */
  handle?: FileSystemFileHandle;
};

/** Extension picks `allowJs` in transpile.ts — nothing else, same contract as pipeline-protocol.ts. */
export function kindFromName(name: string): DeviceSourceKind {
  return /\.(js|mjs)$/i.test(name) ? "js" : "ts";
}

export function supportsFilePicker(): boolean {
  return typeof window !== "undefined" && typeof window.showOpenFilePicker === "function";
}

/** Reads a plain `File` (from `<input>` or a drop event) — never carries a handle. */
export async function openFromBlob(file: File): Promise<OpenedFile> {
  const text = await file.text();
  return { name: file.name, text, kind: kindFromName(file.name) };
}

/**
 * Chromium-only. Resolves `null` on user cancel (`AbortError`) so callers can
 * treat it the same as "nothing chosen" rather than an error toast.
 */
export async function openFilePicker(): Promise<OpenedFile | null> {
  if (!supportsFilePicker()) return null;
  try {
    const [handle] = await window.showOpenFilePicker!({
      types: [
        {
          description: "Shelly script",
          accept: { "text/plain": [".js", ".mjs", ".ts"] },
        },
      ],
      excludeAcceptAllOption: false,
      multiple: false,
    });
    if (!handle) return null;
    const file = await handle.getFile();
    const text = await file.text();
    return { name: file.name, text, kind: kindFromName(file.name), handle };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

/** `FileSystemFileHandle.createWritable()` round trip — the picker-backed save path. */
export async function saveToHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

/** Blob download — the fallback save path, and the mechanism for every artifact download. */
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Same signature as web/lib/api.ts's `api()` / local-api.ts's drop-in. */
type ApiFn = <T>(path: string, init?: RequestInit) => Promise<T & { ok: boolean; error?: string }>;

/** The six `dist` names plus the prod log map — mirrors local-api.ts's artifact map keys. */
export const ARTIFACT_DOWNLOAD_NAMES = [
  "debug.raw.js",
  "debug.js",
  "debug.adv.js",
  "prod.raw.js",
  "prod.js",
  "prod.adv.js",
  "prod.logmap.json",
] as const;

function mimeFor(name: string): string {
  return name.endsWith(".json") ? "application/json" : "text/javascript";
}

async function fetchArtifactCode(api: ApiFn, name: string): Promise<string | null> {
  try {
    const data = await api<{ code: string }>(`/api/artifact?name=${encodeURIComponent(name)}`);
    return data.code;
  } catch {
    return null; // not built yet, or (prod.logmap.json) this build produced no shortened logs
  }
}

/** Throws if `name` hasn't been built yet — the caller surfaces that as a status message. */
export async function downloadArtifact(api: ApiFn, name: string): Promise<void> {
  const code = await fetchArtifactCode(api, name);
  if (code === null) throw new Error(`${name} not built yet`);
  downloadText(name, code, mimeFor(name));
}

/**
 * Fires one download per built artifact, in order, skipping names that
 * aren't available (e.g. `*.adv.js` when tier 3 is off, `prod.logmap.json`
 * when log-shortening produced nothing). Sequential with a small stagger
 * rather than concurrent — some browsers throttle or block a burst of
 * same-tick anchor-click downloads. Returns how many actually downloaded.
 */
export async function downloadAllArtifacts(api: ApiFn): Promise<number> {
  let count = 0;
  for (const name of ARTIFACT_DOWNLOAD_NAMES) {
    const code = await fetchArtifactCode(api, name);
    if (code === null) continue;
    downloadText(name, code, mimeFor(name));
    count++;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return count;
}
