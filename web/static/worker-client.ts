/**
 * Promise-façade over pipeline.worker.ts for the static build.
 *
 * The worker carries TypeScript + Terser (~4 MB raw), so it is constructed
 * lazily on the first build/check/stats call rather than at app boot — loading
 * it eagerly would undo the whole point of splitting it out of app.js. Both
 * compilers are also synchronous CPU hogs; running them off the main thread is
 * what keeps the editor from janking on every build.
 */
import type { PipelineRequest, PipelineResponse } from "./pipeline-protocol";

type Pending = {
  resolve: (value: never) => void;
  reject: (err: Error) => void;
};

let worker: Worker | null = null;
const pending = new Map<string, Pending>();
let nextId = 0;

/**
 * No leading "./": esbuild rewrites `new URL("./x", import.meta.url)` as an
 * asset reference, which would try to bundle the worker into the app chunk.
 * A bare specifier is left alone and resolves at runtime against the emitted
 * app.js, which sits next to pipeline.worker.js in the output directory.
 */
function workerUrl(): URL {
  return new URL("pipeline.worker.js", import.meta.url);
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(workerUrl(), { type: "module" });
  w.onmessage = (ev: MessageEvent<PipelineResponse>) => {
    const msg = ev.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) {
      entry.resolve(msg.result as never);
    } else {
      entry.reject(new Error(msg.error));
    }
  };
  // A worker-level error (module failed to load, OOM) never produces a
  // response message, so every in-flight request would hang forever. Fail them
  // all and drop the worker so the next call constructs a fresh one.
  w.onerror = (ev: ErrorEvent) => {
    const err = new Error(ev.message || "pipeline worker failed");
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
    worker = null;
  };
  worker = w;
  return w;
}

/**
 * Distributive on purpose: a plain `Omit<PipelineRequest, "id">` collapses the
 * union to the keys its members share, which would reject `kind`/`artifacts`.
 */
type RequestBody = PipelineRequest extends infer T
  ? T extends { id: string }
    ? Omit<T, "id"> & { id?: string }
    : never
  : never;

/** Sends one request and resolves with its `result`, or rejects with its `error`. */
export function pipelineRequest<R>(req: RequestBody): Promise<R> {
  const id = req.id ?? `r${nextId++}`;
  const w = ensureWorker();
  return new Promise<R>((resolve, reject) => {
    pending.set(id, { resolve: resolve as Pending["resolve"], reject });
    w.postMessage({ ...req, id } as PipelineRequest);
  });
}
