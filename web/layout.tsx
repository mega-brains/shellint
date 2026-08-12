import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { useSplitter } from "./splitter";

export type LayoutProps = {
  onResize: () => void;
  editor: ComponentChildren;
  side: ComponentChildren;
  footer: ComponentChildren;
};

/**
 * Workspace (editor ↔ sidebar) and main (workspace ↔ footer) splitters.
 */
export function Layout(props: LayoutProps) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const wsSplitRef = useRef<HTMLDivElement>(null);
  const mainSplitRef = useRef<HTMLDivElement>(null);
  const onResize = useRef(props.onResize);
  onResize.current = props.onResize;

  useSplitter(workspaceRef, wsSplitRef, sideRef, {
    storageKey: "shelly-devroom.side.width",
    cssVar: "--side-w",
    minPanel: 168,
    minEditor: 320,
    onResize: () => onResize.current(),
  });

  useSplitter(mainRef, mainSplitRef, workspaceRef, {
    storageKey: "shelly-devroom.workspace.height",
    cssVar: "--workspace-h",
    minPanel: 160,
    minEditor: 120,
    axis: "y",
    sizedClass: "rows-sized",
    onResize: () => onResize.current(),
  });

  return (
    <main ref={mainRef}>
      <div class="workspace" id="workspace" ref={workspaceRef}>
        {props.editor}
        <div
          class="splitter"
          id="workspaceSplitter"
          ref={wsSplitRef}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize editor — drag, arrow keys, or double-click to reset"
          title="Drag to resize the editor · arrow keys to nudge · double-click to reset"
          tabindex={0}
        />
        <aside class="side" id="side" ref={sideRef}>
          {props.side}
        </aside>
      </div>

      <div
        class="splitter splitter-h"
        id="mainSplitter"
        ref={mainSplitRef}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize editor height — drag, arrow keys, or double-click to reset"
        title="Drag to resize the editor height · arrow keys to nudge · double-click to reset"
        tabindex={0}
      />

      <div class="footer">{props.footer}</div>
    </main>
  );
}
