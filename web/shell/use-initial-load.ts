import { useEffect } from "preact/hooks";
import { api } from "../lib/api";
import { loadStats, type DashboardPatch } from "../stats/dashboard";
import type { CheckCatalog } from "../check/check-panel";
import type { Sizes } from "../lib/sizes";

export type InitialLoadSetters = {
  setDeviceIp: (v: string) => void;
  setConfigFail: (v: string | undefined) => void;
  /** `true` under the static/offline build (M17) — local-api.ts's `GET /api/config` sets it. */
  setIsStatic: (v: boolean) => void;
  setCatalog: (v: CheckCatalog | null) => void;
  setDash: (fn: (prev: DashboardPatch) => DashboardPatch) => void;
  setSizeDebug: (v: Sizes) => void;
  setSizeProd: (v: Sizes) => void;
};

/**
 * The one-shot mount-time fetch of `/api/config`, `/api/checks`, and build
 * stats/history — split out of app.tsx to stay under the 500-line cap.
 */
export function useInitialLoad(s: InitialLoadSetters) {
  useEffect(() => {
    void (async () => {
      try {
        const cfg = await api<{
          config: { deviceIp: string; scriptId: number };
          static?: boolean;
        }>("/api/config");
        s.setDeviceIp(cfg.config.deviceIp);
        s.setIsStatic(cfg.static === true);
      } catch {
        s.setConfigFail("config unavailable");
      }
      try {
        const data = await api<CheckCatalog>("/api/checks");
        s.setCatalog({ groups: data.groups, checks: data.checks });
      } catch {
        /* check panel shows unavailable via note when catalog null */
      }
      const stats = await loadStats();
      try {
        const hist = await api<{ history: NonNullable<DashboardPatch["history"]> }>(
          "/api/history?limit=40",
        );
        s.setDash((prev) => ({
          ...prev,
          estimate: stats.estimate,
          minFirmware: stats.minFirmware,
          history: hist.history,
          stats: stats.stats,
          variants: stats.variants,
        }));
        const latest = hist.history[0];
        if (latest) {
          s.setSizeDebug(latest.sizes.debug ?? {});
          s.setSizeProd(latest.sizes.prod ?? {});
        }
      } catch {
        s.setDash((prev) => ({
          ...prev,
          estimate: stats.estimate,
          minFirmware: stats.minFirmware,
          history: [],
          stats: stats.stats,
          variants: stats.variants,
        }));
      }
    })();
  }, []);
}
