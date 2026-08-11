import { createSplitter } from "./splitter";

/**
 * The two resize handles: editor↔sidebar horizontally, and editor↔footer
 * vertically. Owns its element lookups so main.ts stays inside the line cap.
 */
export function createLayout(onResize: () => void): void {
  const workspace = document.getElementById("workspace")!;

  createSplitter(
    {
      root: workspace,
      handle: document.getElementById("workspaceSplitter")!,
      panel: document.getElementById("side")!,
    },
    {
      storageKey: "shelly-devroom.side.width",
      cssVar: "--side-w",
      minPanel: 168,
      minEditor: 320,
      onResize,
    },
  );

  const main = document.querySelector("main");
  const mainSplitter = document.getElementById("mainSplitter");
  if (!main || !mainSplitter) return;

  createSplitter(
    { root: main, handle: mainSplitter, panel: workspace },
    {
      storageKey: "shelly-devroom.workspace.height",
      cssVar: "--workspace-h",
      // Below these the editor stops being usable and the panels stop being
      // readable; the footer scrolls rather than shrinking further.
      minPanel: 160,
      minEditor: 120,
      axis: "y",
      sizedClass: "rows-sized",
      onResize,
    },
  );
}
