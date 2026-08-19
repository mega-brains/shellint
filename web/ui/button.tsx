import type { ComponentChildren, JSX } from "preact";
import { cloneElement, isValidElement, toChildArray } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ComponentChildren;
};

export function Button(props: ButtonProps) {
  const { children, type, ...attrs } = props;
  return (
    <button {...attrs} type={type ?? "button"}>
      {children}
    </button>
  );
}

export type ButtonDropdownProps = {
  rootId: string;
  toggleId: string;
  menuId: string;
  primary: ComponentChildren;
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

export function ButtonDropdown(props: ButtonDropdownProps) {
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

  const menuChild = toChildArray(props.menu)[0];
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
      <Button
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
      </Button>
      {menu}
    </div>
  );
}

export const CLOSE_MENUS_EVENT = "shellint:close-menus";

export function closeAllMenus(): void {
  document.dispatchEvent(new Event(CLOSE_MENUS_EVENT));
}
