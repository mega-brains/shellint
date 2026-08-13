import { useEffect, useRef, useState } from "preact/hooks";

/** Kept in sync with the `flash-change` animation duration in panels.css. */
export const FLASH_MS = 1000;

/**
 * True for `ms` after `value` changes to a *different* value.
 *
 * Deliberately silent in two cases, so the flash only ever means "this build
 * moved the number":
 *   - first render (nothing changed yet)
 *   - the first non-nullish value after a nullish one — that is the panel
 *     filling in on page load, not a build result changing
 */
export function useChangeFlash(value: unknown, ms = FLASH_MS): boolean {
  const prev = useRef(value);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const was = prev.current;
    prev.current = value;
    if (Object.is(was, value) || was == null) return;
    setOn(true);
    const timer = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  return on;
}

/** `class` helper: appends the flash marker only while it is on. */
export function flashClass(base: string | undefined, on: boolean): string | undefined {
  if (!on) return base;
  return base ? `${base} flash-change` : "flash-change";
}
