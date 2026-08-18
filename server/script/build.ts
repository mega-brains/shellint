import { runBuildBackend } from "#shellint/builder";
import type {
  BuildOptions,
  BuildOutput,
} from "../build/builder-backend.ts";

export type {
  BuildSizes,
  SizePair,
} from "../build/builder-backend.ts";

/** Runtime-selected builder facade. Node remains default. */
export function runBuild(options: BuildOptions = {}): Promise<BuildOutput> {
  return runBuildBackend(options);
}
