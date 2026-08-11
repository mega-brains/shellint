export type CollapsibleEls = {
  panel: HTMLElement;
  head: HTMLElement;
  toggle: HTMLElement;
};

export type CollapsibleOptions = {
  storageKey: string;
  defaultCollapsed: boolean;
  /** Clicks on controls inside the head that must not toggle the panel. */
  ignoreSelector?: string;
};

function readCollapsed(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writeCollapsed(key: string, collapsed: boolean) {
  try {
    localStorage.setItem(key, collapsed ? "1" : "0");
  } catch {
    /* private mode / storage disabled */
  }
}

/** Header acts as the disclosure control; state persists across reloads. */
export function createCollapsible(
  els: CollapsibleEls,
  opts: CollapsibleOptions,
) {
  function setCollapsed(collapsed: boolean) {
    els.panel.classList.toggle("collapsed", collapsed);
    els.head.setAttribute("aria-expanded", collapsed ? "false" : "true");
    els.toggle.textContent = collapsed ? "▸" : "▾";
    writeCollapsed(opts.storageKey, collapsed);
  }

  function toggle() {
    setCollapsed(!els.panel.classList.contains("collapsed"));
  }

  els.head.addEventListener("click", (e) => {
    if (
      opts.ignoreSelector &&
      (e.target as HTMLElement).closest(opts.ignoreSelector)
    ) {
      return;
    }
    toggle();
  });

  els.head.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });

  setCollapsed(readCollapsed(opts.storageKey, opts.defaultCollapsed));

  return { setCollapsed, toggle };
}
