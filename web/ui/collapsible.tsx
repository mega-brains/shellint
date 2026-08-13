import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";

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

/**
 * Collapse without useState — classList toggle only, so expanding a panel
 * does not remount sibling panels or reset their local UI state.
 */
export function useCollapsed(storageKey: string, defaultCollapsed: boolean) {
  const collapsed = useRef(readCollapsed(storageKey, defaultCollapsed));
  return {
    collapsed: () => collapsed.current,
    setCollapsed: (next: boolean) => {
      collapsed.current = next;
      writeCollapsed(storageKey, next);
    },
    toggle: () => {
      collapsed.current = !collapsed.current;
      writeCollapsed(storageKey, collapsed.current);
      return collapsed.current;
    },
  };
}

export type CollapsibleProps = {
  storageKey: string;
  defaultCollapsed: boolean;
  ignoreSelector?: string;
  panelId: string;
  panelClass: string;
  bodyId: string;
  headId: string;
  toggleId: string;
  title: string;
  headChildren: ComponentChildren;
  children: ComponentChildren;
  extraClass?: string;
  as?: "section" | "div";
  ariaLabel?: string;
};

/** Header acts as the disclosure control; state persists across reloads. */
export function Collapsible(props: CollapsibleProps) {
  const Tag = props.as ?? "section";
  const panelRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLSpanElement>(null);
  const collapsed = useRef(
    readCollapsed(props.storageKey, props.defaultCollapsed),
  );

  const apply = (next: boolean) => {
    collapsed.current = next;
    panelRef.current?.classList.toggle("collapsed", next);
    headRef.current?.setAttribute("aria-expanded", next ? "false" : "true");
    if (toggleRef.current) toggleRef.current.textContent = next ? "▸" : "▾";
    writeCollapsed(props.storageKey, next);
  };

  useEffect(() => {
    apply(collapsed.current);
  }, []);

  const onHeadClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    if (
      props.ignoreSelector &&
      (e.target as HTMLElement).closest(props.ignoreSelector)
    ) {
      return;
    }
    apply(!collapsed.current);
  };

  const onHeadKey = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      apply(!collapsed.current);
    }
  };

  const initial = collapsed.current;
  const cls = [props.panelClass, props.extraClass, initial ? "collapsed" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <Tag
      ref={panelRef as never}
      class={cls}
      aria-label={props.ariaLabel ?? props.title}
      id={props.panelId}
    >
      <div
        class="panel-head"
        id={props.headId}
        ref={headRef}
        role="button"
        tabindex={0}
        aria-expanded={initial ? "false" : "true"}
        aria-controls={props.bodyId}
        title={props.title}
        onClick={onHeadClick}
        onKeyDown={onHeadKey}
      >
        <span
          class="panel-toggle"
          id={props.toggleId}
          ref={toggleRef}
          aria-hidden="true"
        >
          {initial ? "▸" : "▾"}
        </span>
        {props.headChildren}
      </div>
      {props.children}
    </Tag>
  );
}
