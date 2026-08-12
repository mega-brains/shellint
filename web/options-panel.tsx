import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Collapsible } from "./collapsible";
import { api } from "./api";
import { OPT_TIPS, OptTip, tipStyleFor } from "./option-tip";

export type MinifyOptions = {
  compress: boolean;
  mangle: boolean;
  toplevel: boolean;
  keepFnames: boolean;
  logMap: boolean;
  debugLogMap: boolean;
  advanced: boolean;
};

const DEFAULTS: MinifyOptions = {
  compress: true,
  mangle: true,
  toplevel: false,
  keepFnames: false,
  logMap: true,
  debugLogMap: false,
  advanced: true,
};

type OptDef = {
  key: keyof MinifyOptions;
  id: string;
  label: string;
};

const OPTS: OptDef[] = [
  { key: "compress", id: "optCompress", label: "compress" },
  { key: "mangle", id: "optMangle", label: "mangle" },
  { key: "toplevel", id: "optToplevel", label: "toplevel" },
  { key: "keepFnames", id: "optKeepFnames", label: "keep fnames" },
  { key: "logMap", id: "optLogMap", label: "prod log map" },
  { key: "debugLogMap", id: "optDebugLogMap", label: "debug log map" },
  { key: "advanced", id: "optAdvanced", label: "advanced minify" },
];

const SAVE_MS = 350;

function peekText(opts: MinifyOptions): string {
  const on = OPTS.filter((o) => opts[o.key]).map((o) => o.label);
  return on.length ? on.join(" · ") : "all off";
}

export type OptionsPanelProps = {
  onStatus?: (msg: string, isError?: boolean) => void;
};

/** Collapsible minify knobs → PATCH /api/config. Applies on next build. */
export function OptionsPanel(props: OptionsPanelProps) {
  const [opts, setOpts] = useState<MinifyOptions>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [tipKey, setTipKey] = useState<keyof MinifyOptions | null>(null);
  const [tipStyle, setTipStyle] = useState<JSX.CSSProperties>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Partial<MinifyOptions> | null>(null);
  const onStatus = useRef(props.onStatus);
  onStatus.current = props.onStatus;

  useEffect(() => {
    void (async () => {
      try {
        const data = await api<{ config: { minify?: MinifyOptions } }>(
          "/api/config",
        );
        setOpts({ ...DEFAULTS, ...(data.config.minify ?? {}) });
      } catch {
        onStatus.current?.("minify options unavailable", true);
      } finally {
        setLoaded(true);
      }
    })();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const flush = () => {
    const patch = pending.current;
    pending.current = null;
    if (!patch) return;
    void (async () => {
      try {
        const data = await api<{ config: { minify: MinifyOptions } }>(
          "/api/config",
          {
            method: "PATCH",
            body: JSON.stringify({ minify: patch }),
          },
        );
        setOpts({ ...DEFAULTS, ...data.config.minify });
        onStatus.current?.("minify options saved — apply on next build");
      } catch (err) {
        onStatus.current?.(
          err instanceof Error ? err.message : String(err),
          true,
        );
      }
    })();
  };

  const onToggle = (key: keyof MinifyOptions, value: boolean) => {
    setOpts((prev) => ({ ...prev, [key]: value }));
    pending.current = { ...(pending.current ?? {}), [key]: value };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      flush();
    }, SAVE_MS);
  };

  const openTip = (key: keyof MinifyOptions, el: HTMLElement) => {
    setTipKey(key);
    setTipStyle(tipStyleFor(el.getBoundingClientRect()));
  };

  const closeTip = () => setTipKey(null);

  const tip = tipKey ? OPT_TIPS[tipKey] : null;

  return (
    <Collapsible
      storageKey="shelly-devroom.optionsPanel.collapsed"
      defaultCollapsed={true}
      panelId="optionsPanel"
      panelClass="options"
      bodyId="optionsBody"
      headId="optionsHead"
      toggleId="optionsToggle"
      title="Show or hide minify options (Terser, prod log map, tier-3)"
      ariaLabel="Build options"
      headChildren={
        <>
          <h2>options</h2>
          <p class="panel-peek" id="optionsPeek" data-testid="options-peek">
            {loaded ? peekText(opts) : "…"}
          </p>
        </>
      }
    >
      <div class="options-body" id="optionsBody" data-testid="options-body">
        <p class="options-note" id="optionsNote">
          applies on next build
        </p>
        <ul class="options-list" data-testid="options-list">
          {OPTS.map((o) => (
            <li key={o.key}>
              <label
                class="options-item"
                for={o.id}
                onMouseEnter={(e) =>
                  openTip(o.key, e.currentTarget as HTMLElement)
                }
                onMouseLeave={closeTip}
                onFocusCapture={(e) =>
                  openTip(o.key, e.currentTarget as HTMLElement)
                }
                onBlurCapture={(e) => {
                  const next = e.relatedTarget as Node | null;
                  if (!next || !(e.currentTarget as HTMLElement).contains(next)) {
                    closeTip();
                  }
                }}
              >
                <input
                  type="checkbox"
                  id={o.id}
                  data-testid={`opt-${o.key}`}
                  checked={opts[o.key]}
                  disabled={!loaded}
                  aria-describedby={tipKey === o.key ? "optTipLive" : undefined}
                  onChange={(e) =>
                    onToggle(o.key, (e.target as HTMLInputElement).checked)
                  }
                />
                <span>{o.label}</span>
              </label>
            </li>
          ))}
        </ul>
        {tip ? (
          <OptTip
            open
            content={tip}
            style={tipStyle}
          />
        ) : null}
        {/* Stable id for aria-describedby while a tip is open. */}
        {tip ? <span id="optTipLive" class="visually-hidden">{tip.blurb}</span> : null}
      </div>
    </Collapsible>
  );
}
