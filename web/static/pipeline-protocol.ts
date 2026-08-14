/**
 * Message protocol between the UI and pipeline.worker.ts — plain types only,
 * no logic, so both sides of the postMessage boundary (and a Node-side test
 * harness that drives the worker's logic modules directly, no Worker needed)
 * share one definition. Two request kinds: `build` (M17.3) and `check`
 * (M17.4, the offline compliance check over the in-memory VFS — see
 * ./vfs.ts). `local-api.ts` (M17.5) is what will actually construct these
 * from the fake `/api/build` and `/api/check` routes.
 */
import type { MinifyConfig } from "../../shared/minify-options.mjs";
import type { CheckReport } from "../../server/lint/check.ts";
import type { ScriptStats, StatVariants } from "../../server/script/script-stats.ts";
import type { MemoryEstimate } from "../../server/script/memory-estimate.ts";
import type { MinFirmware } from "../../server/script/min-firmware.ts";

/** Extension picks `allowJs` in transpile.ts — nothing else. */
export type DeviceSourceKind = "ts" | "js";

export type BuildRequest = {
  type: "build";
  /** Correlates a response to its request when several builds are in flight. */
  id: string;
  source: string;
  kind: DeviceSourceKind;
  minify: MinifyConfig;
  /**
   * Parsed types/device-profile.json, or `{}` when no device is active —
   * same contract as deviceGlobalDefsFrom (shared/device-pipeline.mjs):
   * missing fields are left un-substituted, never fed in as `undefined`.
   */
  deviceProfile: Record<string, unknown>;
};

/** One build variant's artifacts — mirrors buildVariant's return shape in scripts/build-shelly.mjs. */
export type VariantArtifacts = {
  raw: string;
  rawBytes: number;
  min: string;
  minBytes: number;
  adv?: string;
  advBytes?: number;
  /** Why tier 3 didn't produce an artifact — mirrors advSkipped there (disabled in config, engine unavailable, etc). */
  advSkipped?: string;
};

export type BuildResult = {
  debug: VariantArtifacts;
  prod: VariantArtifacts;
  /** id -> original text; empty when neither debug nor prod log-shortening ran. */
  logMap: Record<string, string>;
};

export type BuildResponse =
  | { type: "build"; id: string; ok: true; result: BuildResult }
  | { type: "build"; id: string; ok: false; error: string };

/**
 * `runCheck` (server/lint/check.ts) reads `SCRIPT_PATH` and `dist/*` itself
 * rather than taking them as parameters, so the request carries what to seed
 * the VFS with instead of what to check directly.
 */
export type CheckRequest = {
  type: "check";
  /** Correlates a response to its request when several checks are in flight. */
  id: string;
  source: string;
  /**
   * dist/* artifact contents keyed by filename (e.g. "debug.raw.js",
   * "prod.js"), whatever the last build produced — `runCheck` reads the two
   * `*.raw.js` files directly (check.ts's `ARTIFACTS`) and the full
   * debug/prod x raw.js/js/adv.js set for the post-compile dialect guard
   * (dialect-check.ts's `checkBuildArtifacts`). An absent name is simply not
   * checked, same as an absent file on disk.
   */
  artifacts: Record<string, string>;
};

/**
 * `/api/stats` runs here rather than on the main thread because
 * `analyzeSource` and `estimateMemory` both import the TypeScript compiler —
 * calling them from local-api.ts would drag ~3.5 MB of `typescript` into the
 * initial app chunk, which is the one thing the worker split exists to avoid.
 * Seeds the VFS exactly like a check: `analyzeVariants` reads `dist/*` itself.
 */
export type StatsRequest = {
  type: "stats";
  id: string;
  source: string;
  artifacts: Record<string, string>;
};

export type StatsResult = {
  stats: ScriptStats;
  variants: StatVariants;
  estimate: MemoryEstimate;
  minFirmware: MinFirmware;
};

export type PipelineRequest = BuildRequest | CheckRequest | StatsRequest;

export type CheckResponse =
  | { type: "check"; id: string; ok: true; result: CheckReport }
  | { type: "check"; id: string; ok: false; error: string };

export type StatsResponse =
  | { type: "stats"; id: string; ok: true; result: StatsResult }
  | { type: "stats"; id: string; ok: false; error: string };

export type PipelineResponse = BuildResponse | CheckResponse | StatsResponse;
