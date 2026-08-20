/**
 * Worker entry for the M17 static/offline pipeline: `build` (transpile ->
 * env-DCE x2 -> optional minify -> optional tier 3, M17.3) and `check`
 * (M17.4, the full compliance check over an in-memory VFS — see ./vfs.ts).
 * Both run entirely in-process, no disk IO. `build` mirrors
 * scripts/build-shelly.mjs's `main()` variant-by-variant (see that file),
 * sharing one `sharedIds` Map across both variants so a single log map
 * covers both, exactly as the server build does. `check` mirrors
 * server/lint/check.ts's `runCheck` unmodified, over files the VFS shims
 * (web/static/node-shims/) hand it in place of a real disk.
 *
 * Uses `self.onmessage`/`postMessage` through narrow casts rather than the
 * `WebWorker` lib: tsconfig.web.json sets `lib: [...,"DOM",...]` for the rest
 * of web/ (Preact + browser globals), and TypeScript cannot mix the DOM and
 * WebWorker libs in one program (both declare a conflicting global `self`).
 * The casts touch only the one call that actually differs at the type level
 * — DOM's `Window.postMessage` wrongly requires a `targetOrigin` argument
 * that a real Worker's `postMessage` doesn't take; at runtime `self` here is
 * a `DedicatedWorkerGlobalScope`, never a `Window`, so the cast just corrects
 * a type the compiler otherwise has no way to know.
 */
import {
  deviceGlobalDefsFrom,
  transformVariant,
} from "../../shared/device-pipeline.mjs";
import type { MinifyConfig } from "../../shared/minify-options.mjs";
import {
  runCheck,
  type CheckProgress,
  type CheckReport,
} from "../../server/lint/check.ts";
import { DIST_DIR, SCRIPT_PATH } from "../../server/core/paths.ts";
import { analyzeSource, analyzeVariants } from "../../server/script/script-stats.ts";
import { estimateMemory } from "../../server/script/memory-estimate.ts";
import { minFirmware } from "../../server/script/min-firmware.ts";
import { minifyAdvancedBrowser } from "./minify-adv-browser";
import { transpileDevice } from "./transpile";
import { vfsReset, vfsWrite } from "./vfs";
import type {
  BuildRequest,
  BuildResult,
  CheckProgressResponse,
  CheckRequest,
  PipelineRequest,
  PipelineResponse,
  StatsRequest,
  StatsResult,
  VariantArtifacts,
} from "./pipeline-protocol";

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** One variant's artifacts, tier 3 included — mirrors buildVariant in scripts/build-shelly.mjs minus the disk writes. */
async function buildVariant(
  tscJs: string,
  name: "debug" | "prod",
  flags: { debug: boolean; prod: boolean },
  minifyOpts: MinifyConfig,
  logMapState: { sharedIds: Map<string, string>; shorten: boolean },
  deviceDefs: Record<string, unknown>,
): Promise<VariantArtifacts> {
  const { variantOpts, raw, min } = await transformVariant(
    tscJs,
    name,
    flags,
    minifyOpts,
    logMapState,
    deviceDefs,
  );
  const artifacts: VariantArtifacts = {
    raw,
    rawBytes: byteLen(raw),
    min,
    minBytes: byteLen(min),
  };
  // Tier 3 runs on the Terser output, never on its own — same as buildVariant.
  if (variantOpts.advanced !== false) {
    const adv = await minifyAdvancedBrowser(min);
    if (adv.ok) {
      artifacts.adv = adv.code;
      artifacts.advBytes = byteLen(adv.code);
    } else {
      artifacts.advSkipped = adv.reason;
    }
  } else {
    artifacts.advSkipped = "disabled in config";
  }
  return artifacts;
}

async function runBuild(req: BuildRequest): Promise<BuildResult> {
  const tscJs = transpileDevice(
    req.source,
    req.kind === "js" ? "main.js" : "main.ts",
  );
  const minifyOpts = req.minify;
  const shortenDebug = minifyOpts.debugLogMap === true;
  const shortenProd = minifyOpts.logMap !== false;
  /** Shared across variants so one log map covers both, same as build-shelly.mjs. */
  const sharedIds = new Map<string, string>();
  // Computed once, not per variant: meta.device.* is scope "both", so debug
  // and prod get identical substitutions.
  const deviceDefs =
    minifyOpts.deviceDCE === true
      ? deviceGlobalDefsFrom(req.deviceProfile)
      : {};

  const debug = await buildVariant(
    tscJs,
    "debug",
    { debug: true, prod: false },
    minifyOpts,
    { sharedIds, shorten: shortenDebug },
    deviceDefs,
  );
  const prod = await buildVariant(
    tscJs,
    "prod",
    { debug: false, prod: true },
    minifyOpts,
    { sharedIds, shorten: shortenProd },
    deviceDefs,
  );

  const logMap: Record<string, string> = {};
  if (shortenDebug || shortenProd) {
    for (const [text, id] of sharedIds) logMap[id] = text;
  }
  return { debug, prod, logMap };
}

/**
 * Seeds the VFS with the source under the path `runCheck` reads
 * (`SCRIPT_PATH`) plus whatever `dist/*` artifacts the last build produced,
 * then calls `runCheck` unmodified — `connected` is always `false`: a
 * browser cannot digest-auth into a LAN device it has no route to (M17 plan
 * §1), so tier 4 always falls back to "no cached profile" over the VFS.
 * Reset first so a check has no leftover state from an earlier request in
 * the same worker (e.g. a since-removed dist artifact).
 */
async function runCheckRequest(
  req: CheckRequest,
  onProgress?: (progress: CheckProgress) => void,
): Promise<CheckReport> {
  vfsReset();
  vfsWrite(SCRIPT_PATH, req.source);
  for (const [name, content] of Object.entries(req.artifacts)) {
    vfsWrite(`${DIST_DIR}/${name}`, content);
  }
  return runCheck({ connected: false, onProgress });
}

/**
 * Same VFS seeding as a check, for the same reason: `analyzeVariants` reads
 * the `dist/*` artifacts off "disk" to count each tier separately, so the
 * per-variant columns are empty until a build has happened — exactly the
 * server's behaviour before its first build.
 */
async function runStats(req: StatsRequest): Promise<StatsResult> {
  vfsReset();
  vfsWrite(SCRIPT_PATH, req.source);
  for (const [name, content] of Object.entries(req.artifacts)) {
    vfsWrite(`${DIST_DIR}/${name}`, content);
  }
  const stats = analyzeSource(req.source, SCRIPT_PATH);
  return {
    stats,
    variants: await analyzeVariants(stats),
    estimate: estimateMemory(req.source),
    minFirmware: minFirmware(stats.apis),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Never lets a bad request become an unhandled rejection — always resolves to a response message. */
async function handleMessage(
  req: PipelineRequest,
  onProgress?: (progress: CheckProgress) => void,
): Promise<PipelineResponse> {
  if (req.type === "build") {
    try {
      const result = await runBuild(req);
      return { type: "build", id: req.id, ok: true, result };
    } catch (err) {
      return { type: "build", id: req.id, ok: false, error: errorMessage(err) };
    }
  }
  if (req.type === "stats") {
    try {
      return { type: "stats", id: req.id, ok: true, result: await runStats(req) };
    } catch (err) {
      return { type: "stats", id: req.id, ok: false, error: errorMessage(err) };
    }
  }
  try {
    const result = await runCheckRequest(req, onProgress);
    return { type: "check", id: req.id, ok: true, result };
  } catch (err) {
    return { type: "check", id: req.id, ok: false, error: errorMessage(err) };
  }
}

const post = self.postMessage as unknown as (
  msg: PipelineResponse | CheckProgressResponse,
) => void;

self.onmessage = (ev: MessageEvent<PipelineRequest>) => {
  const req = ev.data;
  const onProgress =
    req.type === "check"
      ? (progress: CheckProgress) =>
          post({ type: "check-progress", id: req.id, progress })
      : undefined;
  handleMessage(req, onProgress).then(post);
};
