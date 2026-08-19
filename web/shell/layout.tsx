import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { useSplitter } from "../ui/splitter";

export type LayoutProps = {
  onResize: () => void;
  editor: ComponentChildren;
  side: ComponentChildren;
};

/**
 * Workspace: editor panel ↔ inspector panel, one vertical splitter.
 *
 * There is no horizontal splitter any more — the dock owns a fixed grid row on
 * `#app` (46px collapsed / 300px open), which is what stops it overlapping the
 * workspace below 1000px.
 */
export function Layout(props: LayoutProps) {
  const mainRef = useRef<HTMLElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const onResize = useRef(props.onResize);
  onResize.current = props.onResize;

  useSplitter(mainRef, splitRef, sideRef, {
    storageKey: "shellint.side.width",
    cssVar: "--side-w",
    minPanel: 300,
    minEditor: 360,
    onResize: () => onResize.current(),
  });

  return (
    <main ref={mainRef} id="workspace">
      {props.editor}
      <div
        class="splitter"
        id="workspaceSplitter"
        ref={splitRef}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize editor — drag, arrow keys, or double-click to reset"
        title="Drag to resize the editor · arrow keys to nudge · double-click to reset"
        tabindex={0}
      />
      <aside class="side panel" id="side" ref={sideRef}>
        {props.side}
      </aside>
    </main>
  );
}
