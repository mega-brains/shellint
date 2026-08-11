/** Uncapped script counters as a tile grid — no bar, because there is no cap. */
export type BadgeStats = {
  apis: Record<string, number>;
  declarations: { vars: number; functions: number };
  literals: { strings: { count: number; totalBytes: number } };
  logging: { consoleLog: number; print: number };
  network: { shellyCall: number };
};

type Badge = { value: string; label: string; hint?: string; title: string };

function badgesFrom(stats: BadgeStats): Badge[] {
  const kinds = Object.keys(stats.apis).length;
  const calls = Object.values(stats.apis).reduce((a, b) => a + b, 0);
  const str = stats.literals.strings;
  return [
    {
      value: `${kinds}`,
      label: "api kinds",
      title: `${kinds} distinct Shelly/Espruino APIs used`,
    },
    {
      value: `${calls}`,
      label: "api calls",
      title: `${calls} call sites across those APIs`,
    },
    {
      value: `${stats.declarations.vars}`,
      label: "vars",
      title: "top-level and local variable declarations",
    },
    {
      value: `${stats.declarations.functions}`,
      label: "functions",
      title: "function declarations and expressions",
    },
    {
      value: `${str.count}`,
      label: "strings",
      hint: `${str.totalBytes} B`,
      title: `${str.count} string literals totalling ${str.totalBytes} B`,
    },
    {
      value: `${stats.logging.consoleLog}`,
      label: "console.log",
      title: "console.log/warn/error call sites",
    },
    {
      value: `${stats.logging.print}`,
      label: "print",
      title: "print() call sites — cheaper than console.log on device",
    },
    {
      value: `${stats.network.shellyCall}`,
      label: "Shelly.call",
      title: "asynchronous RPC calls — the device allows 5 concurrent",
    },
  ];
}

export function renderStatBadges(
  host: HTMLElement,
  stats: BadgeStats | null | undefined,
): void {
  host.replaceChildren();
  if (!stats) {
    const empty = document.createElement("p");
    empty.className = "stats-bars-empty";
    empty.textContent = "no stats yet — Build to analyze";
    host.appendChild(empty);
    return;
  }

  for (const badge of badgesFrom(stats)) {
    const tile = document.createElement("div");
    tile.className = "stat-badge";
    tile.title = badge.title;

    const value = document.createElement("span");
    value.className = "stat-badge-value";
    value.textContent = badge.value;

    const label = document.createElement("span");
    label.className = "stat-badge-label";
    label.textContent = badge.label;

    tile.append(value, label);

    if (badge.hint) {
      const hint = document.createElement("span");
      hint.className = "stat-badge-hint";
      hint.textContent = badge.hint;
      tile.appendChild(hint);
    }
    host.appendChild(tile);
  }
}
