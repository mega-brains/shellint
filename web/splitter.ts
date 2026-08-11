export type SplitterEls = {
  /** Flex row holding the editor, the handle and the side panel. */
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
  /** Called after every width change so the editor can re-measure. */
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

  function clamp(px: number): number {
    const room = root.clientWidth - handle.offsetWidth - opts.minEditor;
    return Math.min(Math.max(px, opts.minPanel), Math.max(opts.minPanel, room));
  }

  function apply(px: number | null) {
    if (px === null) root.style.removeProperty(opts.cssVar);
    else root.style.setProperty(opts.cssVar, `${Math.round(px)}px`);
    handle.setAttribute(
      "aria-valuenow",
      String(Math.round(panel.getBoundingClientRect().width)),
    );
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
    document.body.classList.add("col-resizing");
  });

  handle.addEventListener("pointermove", (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    apply(clamp(root.getBoundingClientRect().right - e.clientX));
  });

  function endDrag(e: PointerEvent) {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    handle.releasePointerCapture(e.pointerId);
    handle.classList.remove("dragging");
    document.body.classList.remove("col-resizing");
    set(panel.getBoundingClientRect().width);
  }

  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);

  handle.addEventListener("dblclick", () => set(null));

  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 48 : 16;
    const width = panel.getBoundingClientRect().width;
    if (e.key === "ArrowLeft") set(width + step);
    else if (e.key === "ArrowRight") set(width - step);
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
