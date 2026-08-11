/**
 * A primary action plus a dropdown of variants — the Deploy and Build controls
 * both use it. Picking a variant runs it and becomes the primary action, so the
 * toolbar stays one button wide however many variants exist.
 */
export type SplitButton = {
  close: () => void;
  /** The variant the primary button runs, i.e. the last one picked. */
  choice: () => HTMLButtonElement | null;
};

const open = new Set<SplitButton>();

function closeOthers(except: SplitButton) {
  for (const b of open) if (b !== except) b.close();
}

export function createSplitButton(
  els: {
    root: HTMLElement;
    toggle: HTMLButtonElement;
    menu: HTMLElement;
  },
  onPick: (item: HTMLButtonElement) => void,
): SplitButton {
  let picked: HTMLButtonElement | null = null;

  const api: SplitButton = {
    close: () => setOpen(false),
    choice: () => picked,
  };

  function setOpen(state: boolean) {
    els.menu.hidden = !state;
    els.toggle.setAttribute("aria-expanded", state ? "true" : "false");
    if (state) {
      open.add(api);
      closeOthers(api);
    } else {
      open.delete(api);
    }
  }

  els.toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(els.menu.hidden);
  });

  els.menu.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest("button[role=menuitem]");
    if (!(item instanceof HTMLButtonElement)) return;
    picked = item;
    setOpen(false);
    onPick(item);
  });

  document.addEventListener("click", (e) => {
    if (!els.root.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  return api;
}

/** Shuts every dropdown, e.g. while a long-running action is in flight. */
export function closeAllMenus(): void {
  for (const b of [...open]) b.close();
}
