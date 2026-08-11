export type SplitterEls = {
  /** Flex container holding the panel, the handle and whatever it trades with. */
  root: HTMLElement;
  handle: HTMLElement;
  panel: HTMLElement;
};

export type SplitterOptions = {
  storageKey: string;
  /** Custom property on the root that drives the panel's flex-basis. */
  cssVar: string;
  minPanel: number;
  minEditor: number;
  /** "x" trades width with the panel on the right, "y" height with the top one. */
  axis?: "x" | "y";
  /** Toggled on the root while an explicit size is set, for the CSS to key on. */
  sizedClass?: string;
  /** Called after every size change so the editor can re-measure. */
  onResize?: () => void;
};

function readWidth(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const px = Number(raw);
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

function writeWidth(key: string, px: number | null) {
  try {
    if (px === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(Math.round(px)));
  } catch {
    /* private mode / storage disabled */
  }
}

/**
 * Drag (or arrow-key) the handle to trade width between the editor and the
 * side panel; double-click drops back to the stylesheet default.
 */
export function createSplitter(els: SplitterEls, opts: SplitterOptions) {
  const { root, handle, panel } = els;
  const vertical = opts.axis === "y";

  /** The panel's own extent along the dragged axis. */
  function panelSize(): number {
    const rect = panel.getBoundingClientRect();
    return vertical ? rect.height : rect.width;
  }

  function clamp(px: number): number {
    const total = vertical ? root.clientHeight : root.clientWidth;
    const handleSize = vertical ? handle.offsetHeight : handle.offsetWidth;
    const room = total - handleSize - opts.minEditor;
    return Math.min(Math.max(px, opts.minPanel), Math.max(opts.minPanel, room));
  }

  function apply(px: number | null) {
    if (px === null) root.style.removeProperty(opts.cssVar);
    else root.style.setProperty(opts.cssVar, `${Math.round(px)}px`);
    if (opts.sizedClass) root.classList.toggle(opts.sizedClass, px !== null);
    handle.setAttribute("aria-valuenow", String(Math.round(panelSize())));
    opts.onResize?.();
  }

  function set(px: number | null) {
    const next = px === null ? null : clamp(px);
    apply(next);
    writeWidth(opts.storageKey, next);
  }

  handle.addEventListener("pointerdown", (e) => {
    // Only the primary button drags; keep context menus and middle-click alone.
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add(vertical ? "row-resizing" : "col-resizing");
  });

  handle.addEventListener("pointermove", (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const box = root.getBoundingClientRect();
    // The horizontal panel sits at the top, the vertical one on the right, so
    // each measures from the edge it is anchored to.
    apply(clamp(vertical ? e.clientY - box.top : box.right - e.clientX));
  });

  function endDrag(e: PointerEvent) {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    handle.releasePointerCapture(e.pointerId);
    handle.classList.remove("dragging");
    document.body.classList.remove(vertical ? "row-resizing" : "col-resizing");
    set(panelSize());
  }

  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);

  handle.addEventListener("dblclick", () => set(null));

  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 48 : 16;
    const size = panelSize();
    const grow = vertical ? "ArrowDown" : "ArrowLeft";
    const shrink = vertical ? "ArrowUp" : "ArrowRight";
    if (e.key === grow) set(size + step);
    else if (e.key === shrink) set(size - step);
    else if (e.key === "Home" || e.key === "End") set(null);
    else return;
    e.preventDefault();
  });

  // A stored width can outgrow a smaller window, so re-clamp on resize.
  window.addEventListener("resize", () => {
    const stored = readWidth(opts.storageKey);
    if (stored !== null) apply(clamp(stored));
  });

  apply(readWidth(opts.storageKey));

  return { set };
}
