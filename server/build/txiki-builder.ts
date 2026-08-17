import ts from "typescript";
import {
  deviceGlobalDefsFrom,
  transformVariant,
} from "../../shared/device-pipeline.mjs";
import {
  DEFAULT_MINIFY,
  MINIFY_KEYS,
  type MinifyConfig,
} from "../../shared/minify-options.mjs";
import {
  DEVICE_COMPILER_OPTIONS,
  transpileDevice,
} from "../../web/static/transpile.ts";
import { minifyAdvancedBrowser } from "../../web/static/minify-adv-browser.ts";
import {
  joinPath,
  normalizePath,
  resolvePath,
  type RuntimeAdapter,
} from "./runtime-adapter.ts";

const DEFAULT_SOURCE = "scripts/main.ts";
const DEFAULT_DIST = "dist";
const DEFAULT_PROFILE = "types/device-profile.json";
const DEFAULT_DECLARATIONS = [
  "types/espruino-lib.d.ts",
  "types/meta.d.ts",
  "types/shelly.d.ts",
] as const;

export type PortableDiagnostic = {
  category: "warning" | "error" | "suggestion" | "message";
  code: number;
  message: string;
  file?: string;
  line?: number;
  column?: number;
};

export type PortableVariant = {
  raw: string;
  rawBytes: number;
  min: string;
  minBytes: number;
  adv?: string;
  advBytes?: number;
  advSkipped?: string;
  interned: number;
  internedBytes: number;
};

export type PortableBuildOptions = {
  root: string;
  sourcePath?: string;
  distDir?: string;
  declarationPaths?: string[];
  deviceProfilePath?: string;
  deviceProfile?: Record<string, unknown>;
  minify?: Partial<MinifyConfig>;
  skipTypeCheck?: boolean;
};

export type PortableBuildResult = {
  debug: PortableVariant;
  prod: PortableVariant;
  diagnostics: PortableDiagnostic[];
  warnings: string[];
  logMap: Record<string, string>;
  artifacts: Record<string, string>;
  sizes: {
    debug: { raw: number; min: number; adv?: number };
    prod: { raw: number; min: number; adv?: number };
  };
};

export class PortableTypeCheckError extends Error {
  constructor(public readonly diagnostics: PortableDiagnostic[]) {
    const first = diagnostics.find((diagnostic) => diagnostic.category === "error");
    super(first ? `TypeScript ${first.code}: ${first.message}` : "TypeScript check failed");
    this.name = "PortableTypeCheckError";
  }
}

function byteLen(value: string): number {
  return new TextEncoder().encode(value).length;
}

function categoryName(category: ts.DiagnosticCategory): PortableDiagnostic["category"] {
  switch (category) {
    case ts.DiagnosticCategory.Warning:
      return "warning";
    case ts.DiagnosticCategory.Suggestion:
      return "suggestion";
    case ts.DiagnosticCategory.Message:
      return "message";
    default:
      return "error";
  }
}

function serializeDiagnostic(diagnostic: ts.Diagnostic): PortableDiagnostic {
  const out: PortableDiagnostic = {
    category: categoryName(diagnostic.category),
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  };
  if (diagnostic.file && diagnostic.start != null) {
    const point = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    out.file = normalizePath(diagnostic.file.fileName);
    out.line = point.line + 1;
    out.column = point.character + 1;
  }
  return out;
}

function scriptKind(path: string): ts.ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.(m|c)?js$/i.test(path)) return ts.ScriptKind.JS;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  if (/\.json$/i.test(path)) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

function checkSources(
  root: string,
  sourcePath: string,
  files: Map<string, string>,
): PortableDiagnostic[] {
  const isJs = /\.(m|c)?js$/i.test(sourcePath);
  const options: ts.CompilerOptions = {
    ...DEVICE_COMPILER_OPTIONS,
    noEmit: true,
    ...(isJs ? { allowJs: true, checkJs: false } : {}),
  };
  const host: ts.CompilerHost = {
    getSourceFile(fileName, languageVersion) {
      const normalized = normalizePath(fileName);
      const text = files.get(normalized);
      if (text == null) return undefined;
      return ts.createSourceFile(
        normalized,
        text,
        languageVersion,
        true,
        scriptKind(normalized),
      );
    },
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => root,
    getDirectories: () => [],
    fileExists: (fileName) => files.has(normalizePath(fileName)),
    readFile: (fileName) => files.get(normalizePath(fileName)),
    getCanonicalFileName: (fileName) => normalizePath(fileName),
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    realpath: (fileName) => normalizePath(fileName),
    directoryExists(directoryName) {
      const prefix = `${normalizePath(directoryName)}/`;
      for (const path of files.keys()) {
        if (path.startsWith(prefix)) return true;
      }
      return false;
    },
  };
  const program = ts.createProgram({
    rootNames: [...files.keys()],
    options,
    host,
  });
  return ts.getPreEmitDiagnostics(program).map(serializeDiagnostic);
}

function mergeMinify(input?: Partial<MinifyConfig>): MinifyConfig {
  const out: MinifyConfig = { ...DEFAULT_MINIFY };
  if (!input) return out;
  for (const key of MINIFY_KEYS) {
    if (typeof input[key] === "boolean") out[key] = input[key]!;
  }
  return out;
}

async function loadMinify(
  adapter: RuntimeAdapter,
  root: string,
  input?: Partial<MinifyConfig>,
): Promise<MinifyConfig> {
  if (input) return mergeMinify(input);
  const path = joinPath(root, "devroom.json");
  if (!(await adapter.exists(path))) return mergeMinify();
  const raw = JSON.parse(await adapter.readText(path)) as Record<string, unknown>;
  if (raw.compiler != null && raw.compiler !== "devroom") {
    throw new Error(`compiler ${JSON.stringify(raw.compiler)} is unsupported`);
  }
  const value = raw.minify;
  return mergeMinify(
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<MinifyConfig>)
      : undefined,
  );
}

async function loadProfile(
  adapter: RuntimeAdapter,
  path: string,
  supplied: Record<string, unknown> | undefined,
  warnings: string[],
): Promise<Record<string, unknown>> {
  if (supplied) return supplied;
  if (!(await adapter.exists(path))) {
    warnings.push(`${path} missing; meta.device values remain unchanged`);
    return {};
  }
  try {
    const parsed = JSON.parse(await adapter.readText(path));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${path} invalid: ${message}`);
    return {};
  }
  warnings.push(`${path} must contain JSON object`);
  return {};
}

async function buildVariant(
  tscJs: string,
  name: "debug" | "prod",
  minify: MinifyConfig,
  sharedIds: Map<string, string>,
  deviceDefs: Record<string, unknown>,
): Promise<PortableVariant> {
  const flags = name === "debug"
    ? { debug: true, prod: false }
    : { debug: false, prod: true };
  const shorten = name === "debug"
    ? minify.debugLogMap === true
    : minify.logMap !== false;
  const transformed = await transformVariant(
    tscJs,
    name,
    flags,
    minify,
    { sharedIds, shorten },
    deviceDefs,
  );
  const result: PortableVariant = {
    raw: transformed.raw,
    rawBytes: byteLen(transformed.raw),
    min: transformed.min,
    minBytes: byteLen(transformed.min),
    interned: transformed.interned.interned,
    internedBytes: transformed.interned.savedBytes,
  };
  if (transformed.variantOpts.advanced === false) {
    result.advSkipped = "disabled in config";
    return result;
  }
  const advanced = await minifyAdvancedBrowser(transformed.min);
  if (!advanced.ok) {
    result.advSkipped = advanced.reason;
    return result;
  }
  result.adv = advanced.code;
  result.advBytes = byteLen(advanced.code);
  return result;
}

async function writeOutputs(
  adapter: RuntimeAdapter,
  distDir: string,
  artifacts: Record<string, string>,
): Promise<void> {
  await adapter.makeDir(distDir);
  for (const stale of ["debug.adv.js", "prod.adv.js", "prod.logmap.json"]) {
    const path = joinPath(distDir, stale);
    if (await adapter.exists(path)) await adapter.remove(path);
  }
  for (const [name, contents] of Object.entries(artifacts)) {
    await adapter.writeText(joinPath(distDir, name), contents);
  }
}

/** Portable Shelly build using only caller-supplied runtime IO. */
export async function buildShellyPortable(
  adapter: RuntimeAdapter,
  options: PortableBuildOptions,
): Promise<PortableBuildResult> {
  const root = normalizePath(options.root);
  const sourcePath = resolvePath(root, options.sourcePath ?? DEFAULT_SOURCE);
  const distDir = resolvePath(root, options.distDir ?? DEFAULT_DIST);
  const declarationPaths = (options.declarationPaths ?? [...DEFAULT_DECLARATIONS])
    .map((path) => resolvePath(root, path));
  const profilePath = resolvePath(root, options.deviceProfilePath ?? DEFAULT_PROFILE);
  const source = await adapter.readText(sourcePath);
  const diagnostics: PortableDiagnostic[] = [];

  if (!options.skipTypeCheck) {
    const files = new Map<string, string>([[sourcePath, source]]);
    for (const path of declarationPaths) {
      files.set(path, await adapter.readText(path));
    }
    diagnostics.push(...checkSources(root, sourcePath, files));
    if (diagnostics.some((diagnostic) => diagnostic.category === "error")) {
      throw new PortableTypeCheckError(diagnostics);
    }
  }

  const minify = await loadMinify(adapter, root, options.minify);
  const warnings: string[] = [];
  const profile = minify.deviceDCE
    ? await loadProfile(adapter, profilePath, options.deviceProfile, warnings)
    : {};
  const deviceDefs = minify.deviceDCE ? deviceGlobalDefsFrom(profile) : {};
  const tscJs = transpileDevice(source, sourcePath);
  const sharedIds = new Map<string, string>();
  const debug = await buildVariant(tscJs, "debug", minify, sharedIds, deviceDefs);
  const prod = await buildVariant(tscJs, "prod", minify, sharedIds, deviceDefs);

  const logMap: Record<string, string> = {};
  if (minify.debugLogMap || minify.logMap) {
    for (const [text, id] of sharedIds) logMap[id] = text;
  }
  const artifacts: Record<string, string> = {
    "debug.raw.js": debug.raw,
    "debug.js": debug.min,
    "prod.raw.js": prod.raw,
    "prod.js": prod.min,
  };
  if (debug.adv != null) artifacts["debug.adv.js"] = debug.adv;
  else if (debug.advSkipped) warnings.push(`debug tier 3 skipped: ${debug.advSkipped}`);
  if (prod.adv != null) artifacts["prod.adv.js"] = prod.adv;
  else if (prod.advSkipped) warnings.push(`prod tier 3 skipped: ${prod.advSkipped}`);
  if (Object.keys(logMap).length) {
    artifacts["prod.logmap.json"] = `${JSON.stringify(logMap, null, 2)}\n`;
  }
  await writeOutputs(adapter, distDir, artifacts);

  return {
    debug,
    prod,
    diagnostics,
    warnings,
    logMap,
    artifacts,
    sizes: {
      debug: {
        raw: debug.rawBytes,
        min: debug.minBytes,
        ...(debug.advBytes == null ? {} : { adv: debug.advBytes }),
      },
      prod: {
        raw: prod.rawBytes,
        min: prod.minBytes,
        ...(prod.advBytes == null ? {} : { adv: prod.advBytes }),
      },
    },
  };
}
