declare const meta: {
  env: {
    readonly debug: boolean;
    readonly prod: boolean;
  };
  /**
   * Device-profile-driven build-time constants (from `types/device-profile.json`).
   * Only substituted when `minify.deviceDCE` is on — the build's `envPass`
   * folds these into literals and dead-code-eliminates the branches that
   * become unreachable, the same way `meta.env.*` does. With `deviceDCE` off,
   * or when the profile is missing a field, referencing that field here
   * compiles fine but is never substituted on device — it stays a bare
   * `meta.device.*` reference, which does not exist on the Espruino runtime.
   * Gate any use of these behind `deviceDCE` being the build you actually ship.
   */
  device: {
    readonly gen: number;
    readonly model: string;
    readonly fw: string;
  };
};
