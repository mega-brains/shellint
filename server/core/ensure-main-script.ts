import { runtime } from "#shellint/runtime";
import { ROOT, SCRIPT_PATH } from "./paths.ts";

type EnsureMainOptions = {
  scriptPath?: string;
  overridden?: boolean;
};

/** Create starter only for missing default script. */
export async function ensureMainScript(options: EnsureMainOptions = {}): Promise<boolean> {
  const scriptPath = options.scriptPath ?? SCRIPT_PATH;
  const overridden = options.overridden ?? Boolean(runtime.process.env.SHELLINT_SCRIPT?.trim());
  if (overridden || (await runtime.fs.exists(scriptPath))) return false;
  const template = runtime.path.join(ROOT, "templates", "main.example.ts");
  const source = await runtime.fs.readText(template);
  await runtime.fs.mkdir(runtime.path.dirname(scriptPath), { recursive: true });
  await runtime.fs.atomicWriteText(scriptPath, source);
  return true;
}
