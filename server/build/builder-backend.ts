export type SizePair = {
  raw?: number;
  min?: number;
  /** Tier 3 — absent whenever advanced minification is unavailable. */
  adv?: number;
};

export type BuildSizes = {
  debug: SizePair;
  prod: SizePair;
};

export type BuildOptions = {
  skipTypeCheck?: boolean;
};

export type BuildOutput = {
  sizes: BuildSizes;
  stdout: string;
  stderr: string;
};

export type BuildBackend = (options?: BuildOptions) => Promise<BuildOutput>;

