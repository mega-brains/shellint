import { useEffect, useRef } from "preact/hooks";

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
 * Drag (or arrow-key) the handle to trade size between the panel and its peer.
 * Attaches listeners to refs — layout chrome stays declarative Preact.
 */
export function useSplitter(
  rootRef: { current: HTMLElement | null },
  handleRef: { current: HTMLElement | null },
  panelRef: { current: HTMLElement | null },
  opts: SplitterOptions,
) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const root = rootRef.current;
    const handle = handleRef.current;
    const panel = panelRef.current;
    if (!root || !handle || !panel) return;

    const vertical = optsRef.current.axis === "y";

    function panelSize(): number {
      const rect = panel!.getBoundingClientRect();
      return vertical ? rect.height : rect.width;
    }

    function clamp(px: number): number {
      const o = optsRef.current;
      const total = vertical ? root!.clientHeight : root!.clientWidth;
      const handleSize = vertical ? handle!.offsetHeight : handle!.offsetWidth;
      const room = total - handleSize - o.minEditor;
      return Math.min(Math.max(px, o.minPanel), Math.max(o.minPanel, room));
    }

    function apply(px: number | null) {
      const o = optsRef.current;
      if (px === null) root!.style.removeProperty(o.cssVar);
      else root!.style.setProperty(o.cssVar, `${Math.round(px)}px`);
      if (o.sizedClass) root!.classList.toggle(o.sizedClass, px !== null);
      handle!.setAttribute("aria-valuenow", String(Math.round(panelSize())));
      o.onResize?.();
    }

    function set(px: number | null) {
      const next = px === null ? null : clamp(px);
      apply(next);
      writeWidth(optsRef.current.storageKey, next);
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle!.setPointerCapture(e.pointerId);
      handle!.classList.add("dragging");
      document.body.classList.add(vertical ? "row-resizing" : "col-resizing");
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!handle!.hasPointerCapture(e.pointerId)) return;
      const box = root!.getBoundingClientRect();
      apply(clamp(vertical ? e.clientY - box.top : box.right - e.clientX));
    };

    const endDrag = (e: PointerEvent) => {
      if (!handle!.hasPointerCapture(e.pointerId)) return;
      handle!.releasePointerCapture(e.pointerId);
      handle!.classList.remove("dragging");
      document.body.classList.remove(
        vertical ? "row-resizing" : "col-resizing",
      );
      set(panelSize());
    };

    const onDblClick = () => set(null);

    const onKeyDown = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 48 : 16;
      const size = panelSize();
      const grow = vertical ? "ArrowDown" : "ArrowLeft";
      const shrink = vertical ? "ArrowUp" : "ArrowRight";
      if (e.key === grow) set(size + step);
      else if (e.key === shrink) set(size - step);
      else if (e.key === "Home" || e.key === "End") set(null);
      else return;
      e.preventDefault();
    };

    const onResize = () => {
      const stored = readWidth(optsRef.current.storageKey);
      if (stored !== null) apply(clamp(stored));
    };

    handle.addEventListener("pointerdown", onPointerDown);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    handle.addEventListener("dblclick", onDblClick);
    handle.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);

    apply(readWidth(optsRef.current.storageKey));

    return () => {
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", endDrag);
      handle.removeEventListener("pointercancel", endDrag);
      handle.removeEventListener("dblclick", onDblClick);
      handle.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [rootRef, handleRef, panelRef]);
}
