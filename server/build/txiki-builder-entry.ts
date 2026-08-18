import { runtime } from "#shellint/runtime";
import type { RuntimeAdapter as BuildRuntimeAdapter } from "./runtime-adapter.ts";
import type { BuildOptions, BuildOutput } from "./builder-backend.ts";
import { buildShellyPortable } from "./txiki-builder.ts";
import { DIST_DIR, SCRIPT_PATH } from "../core/paths.ts";
import { ensureMainScript } from "../core/ensure-main-script.ts";

const adapter: BuildRuntimeAdapter = {
  readText: (path) => runtime.fs.readText(path),
  writeText: (path, contents) => runtime.fs.writeText(path, contents),
  exists: (path) => runtime.fs.exists(path),
  makeDir: (path) => runtime.fs.mkdir(path, { recursive: true }),
  remove: (path) => runtime.fs.remove(path, { force: true }),
};

/** In-process txiki builder, selected through `--conditions=txiki`. */
export async function runBuildBackend(
  options: BuildOptions = {},
): Promise<BuildOutput> {
  await ensureMainScript();
  const result = await buildShellyPortable(adapter, {
    root: runtime.process.cwd,
    // Honour the SHELLINT_SCRIPT/SHELLINT_DIST overrides Node backend gets
    // for free through the environment of its `npm run build:shelly` child.
    sourcePath: SCRIPT_PATH,
    distDir: DIST_DIR,
    skipTypeCheck: options.skipTypeCheck,
  });
  const stdout = `${JSON.stringify(result.sizes, null, 2)}\n`;
  const stderr = result.warnings.length ? `${result.warnings.join("\n")}\n` : "";
  return { sizes: result.sizes, stdout, stderr };
}
