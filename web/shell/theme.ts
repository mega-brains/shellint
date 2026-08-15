import { useEffect, useState } from "preact/hooks";

export type Theme = "dark" | "light";

const KEY = "shelly-devroom.theme";

function systemTheme(): Theme {
  try {
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    /* private mode / storage disabled */
  }
  return systemTheme();
}

/**
 * Explicit theme choice. The stylesheet still paints from
 * prefers-color-scheme before the bundle runs (`:root:not([data-theme])`),
 * so setting the attribute here only ever *overrides* the OS, never flashes.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return [
    theme,
    () => {
      const next: Theme = theme === "dark" ? "light" : "dark";
      setTheme(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* the switch still holds for this session */
      }
    },
  ];
}
