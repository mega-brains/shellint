import { useEffect } from "preact/hooks";
import { api } from "./api";
import { loadStats, type DashboardPatch } from "./dashboard";
import type { CheckCatalog } from "./check-panel";
import type { Sizes } from "./sizes";

export type InitialLoadSetters = {
  setDeviceIp: (v: string) => void;
  setConfigFail: (v: string | undefined) => void;
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
        }>("/api/config");
        s.setDeviceIp(cfg.config.deviceIp);
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
