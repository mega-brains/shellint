import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export type InspectorTab = "build" | "check" | "options";

const KEY = "shelly-devroom.inspectorTab";

const TABS: { id: InspectorTab; label: string; title: string }[] = [
  { id: "build", label: "build", title: "Sizes, counters, caps and the RAM estimate" },
  { id: "check", label: "check", title: "Every compliance check, what it enforces and its verdict" },
  { id: "options", label: "options", title: "Minify options (Terser, prod log map, tier 3)" },
];

function readTab(): InspectorTab {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "build" || v === "check" || v === "options") return v;
  } catch {
    /* private mode / storage disabled */
  }
  return "build";
}

/** Tab choice + its persistence, so the readiness rail can switch panes too. */
export function useInspectorTab(): [InspectorTab, (next: InspectorTab) => void] {
  const [tab, setTab] = useState<InspectorTab>(readTab);
  return [
    tab,
    (next: InspectorTab) => {
      setTab(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* the tab still switches for this session */
      }
    },
  ];
}

export type InspectorProps = {
  tab: InspectorTab;
  onTab: (next: InspectorTab) => void;
  build: ComponentChildren;
  check: ComponentChildren;
  options: ComponentChildren;
  /** Count shown on the inactive check tab; `fail` colours it danger. */
  checkBadge: { text: string; fail: boolean } | null;
  /** "59/60" — passing rules, right end of the strip. */
  checkScale: string;
  /** Flips true when a check run failed; warnings never steal the tab. */
  checkFailed: boolean;
};

/**
 * The inspector's three panes as a tab strip (M18). The old sidebar stacked
 * build/check/options as accordions in one scroller, so opening check meant
 * hand-collapsing build; exactly one pane is visible now and the choice is
 * remembered.
 */
export function Inspector(props: InspectorProps) {
  const { tab, onTab } = props;
  const select = onTab;
  const onTabRef = useRef(onTab);
  onTabRef.current = onTab;

  // A failing check is the one result worth interrupting for; an advisory is not.
  useEffect(() => {
    if (props.checkFailed) onTabRef.current("check");
  }, [props.checkFailed]);

  return (
    <>
      <div class="tabs" id="inspectorTabs" role="tablist" aria-label="Inspector">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            data-testid={`tab-${t.id}`}
            class={`tab${tab === t.id ? " active" : ""}`}
            aria-selected={tab === t.id ? "true" : "false"}
            aria-controls={`pane-${t.id}`}
            title={t.title}
            onClick={() => select(t.id)}
          >
            {t.label}
            {t.id === "check" && props.checkBadge && tab !== "check" ? (
              <span
                class={`tab-count${props.checkBadge.fail ? " fail" : ""}`}
                id="checkPeek"
              >
                {props.checkBadge.text}
              </span>
            ) : null}
          </button>
        ))}
        <span class="tabs-spacer" />
        <span class="tabs-scale" id="checkScale">
          {tab === "check" ? props.checkScale : null}
        </span>
      </div>
      {/* All three stay mounted and are hidden instead of swapped: switching a
          tab must not refetch /api/config or drop the check panel's kept rows. */}
      {TABS.map((t) => (
        <div
          key={t.id}
          class="pane"
          id={`pane-${t.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${t.id}`}
          hidden={tab !== t.id}
        >
          {t.id === "build" ? props.build : null}
          {t.id === "check" ? props.check : null}
          {t.id === "options" ? props.options : null}
        </div>
      ))}
    </>
  );
}
