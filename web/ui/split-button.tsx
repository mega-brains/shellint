import type { ComponentChildren, JSX } from "preact";
import { cloneElement, isValidElement, toChildArray } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export type SplitButtonProps = {
  rootId: string;
  toggleId: string;
  menuId: string;
  primary: ComponentChildren;
  /** Single menu element (`ul` or `div`); `hidden` is applied from open state. */
  menu: ComponentChildren;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onPick?: (item: HTMLButtonElement) => void;
  disabled?: boolean;
  toggleTitle?: string;
  toggleHasPopup?: "menu" | "true";
  className?: string;
  closeOnOutside?: boolean;
};

/**
 * A primary action plus a dropdown of variants. Controlled or uncontrolled.
 */
export function SplitButton(props: SplitButtonProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = props.open !== undefined;
  const open = controlled ? !!props.open : internalOpen;
  const closeOnOutside = props.closeOnOutside !== false;

  const setOpen = (next: boolean) => {
    if (!controlled) setInternalOpen(next);
    props.onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open || !closeOnOutside) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, closeOnOutside]);

  const onToggle = (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setOpen(!open);
  };

  const onMenuClick = (e: JSX.TargetedMouseEvent<HTMLElement>) => {
    const item = (e.target as HTMLElement).closest("button[role=menuitem]");
    if (!(item instanceof HTMLButtonElement)) return;
    setOpen(false);
    props.onPick?.(item);
  };

  const kids = toChildArray(props.menu);
  const menuChild = kids[0];
  const menu = isValidElement(menuChild)
    ? cloneElement(menuChild, {
        hidden: !open,
        onClick: (e: JSX.TargetedMouseEvent<HTMLElement>) => {
          const prev = (
            menuChild.props as {
              onClick?: (e: JSX.TargetedMouseEvent<HTMLElement>) => void;
            }
          ).onClick;
          prev?.(e);
          onMenuClick(e);
        },
      } as JSX.HTMLAttributes)
    : props.menu;

  return (
    <div class={props.className ?? "split"} id={props.rootId} ref={rootRef}>
      {props.primary}
      <button
        type="button"
        id={props.toggleId}
        class="split-toggle"
        aria-haspopup={props.toggleHasPopup ?? "menu"}
        aria-expanded={open ? "true" : "false"}
        aria-controls={props.menuId}
        title={props.toggleTitle}
        disabled={props.disabled}
        onClick={onToggle}
      >
        ▾
      </button>
      {menu}
    </div>
  );
}

export const CLOSE_MENUS_EVENT = "devroom:close-menus";

export function closeAllMenus(): void {
  document.dispatchEvent(new Event(CLOSE_MENUS_EVENT));
}
