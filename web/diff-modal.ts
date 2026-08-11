import { diffLines, wordDiff, type Segment } from "./diff";

/**
 * Any two versions of the script, side by side in a modal — the sidebar-width
 * editor has no room for two columns, and a full-window overlay costs no
 * layout. Which two is picked inside the dialog, so comparisons can be walked
 * through (source → raw → minified) without reopening it.
 */
export type DiffOption = { id: string; label: string };

/** Resolves an option to its text. The caller owns fetching and caching. */
export type DiffLoader = (id: string) => Promise<string>;

type Cell = { n: number; text: string; parts?: Segment[] } | null;
type Row = { left: Cell; right: Cell; changed: boolean };

/** Deletions and insertions line up as pairs; the shorter run pads with blanks. */
function pair(left: string[], right: string[]): Row[] {
  const lines = diffLines(left, right);
  const rows: Row[] = [];
  let ln = 0;
  let rn = 0;

  for (let i = 0; i < lines.length; ) {
    if (lines[i].tag === " ") {
      const text = lines[i].text;
      rows.push({
        left: { n: ++ln, text },
        right: { n: ++rn, text },
        changed: false,
      });
      i += 1;
      continue;
    }
    const dels: string[] = [];
    const adds: string[] = [];
    while (i < lines.length && lines[i].tag !== " ") {
      const line = lines[i++];
      (line.tag === "-" ? dels : adds).push(line.text);
    }
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      // A line replaced by another is worth a word diff; an outright
      // insertion or deletion has nothing to compare against.
      const both = k < dels.length && k < adds.length;
      const words = both ? wordDiff(dels[k], adds[k]) : null;
      rows.push({
        left:
          k < dels.length
            ? { n: ++ln, text: dels[k], parts: words?.left }
            : null,
        right:
          k < adds.length
            ? { n: ++rn, text: adds[k], parts: words?.right }
            : null,
        changed: true,
      });
    }
  }
  return rows;
}

/** The code text, with the words that differ marked when a word diff exists. */
function fillCode(
  host: HTMLElement,
  value: NonNullable<Cell>,
  side: "del" | "add",
): void {
  if (!value.parts) {
    host.textContent = value.text;
    return;
  }
  for (const part of value.parts) {
    if (!part.changed) {
      host.append(part.text);
      continue;
    }
    const hit = document.createElement("span");
    hit.className = `diff-word diff-word-${side}`;
    hit.textContent = part.text;
    host.appendChild(hit);
  }
}

function cell(value: Cell, changed: boolean, side: "del" | "add"): HTMLElement[] {
  const num = document.createElement("td");
  num.className = "diff-num";
  const body = document.createElement("td");
  body.className = "diff-code";
  if (!value) {
    num.classList.add("diff-blank");
    body.classList.add("diff-blank");
    return [num, body];
  }
  num.textContent = `${value.n}`;
  fillCode(body, value, side);
  if (changed) body.classList.add(`diff-${side}`);
  return [num, body];
}

function buildTable(rows: Row[]): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "diff-table";
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.append(
      ...cell(row.left, row.changed, "del"),
      ...cell(row.right, row.changed, "add"),
    );
    body.appendChild(tr);
  }
  table.appendChild(body);
  return table;
}

/** One row of the unified table: both line numbers, a sign, and the text. */
function unifiedRow(
  value: NonNullable<Cell>,
  sign: " " | "+" | "-",
  nums: [string, string],
) {
  const side = sign === "-" ? "del" : "add";
  const tr = document.createElement("tr");
  for (const n of nums) {
    const td = document.createElement("td");
    td.className = "diff-num";
    td.textContent = n;
    tr.appendChild(td);
  }

  const mark = document.createElement("td");
  mark.className = "diff-sign";
  mark.textContent = sign;

  const body = document.createElement("td");
  body.className = "diff-code";
  fillCode(body, value, side);
  if (sign !== " ") {
    mark.classList.add(`diff-${side}`);
    body.classList.add(`diff-${side}`);
  }

  tr.append(mark, body);
  return tr;
}

/**
 * The same rows in one column. Removals of a run come before its insertions,
 * the way a patch reads, rather than alternating one line at a time.
 */
function buildUnified(rows: Row[]): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "diff-table diff-unified";
  const body = document.createElement("tbody");

  for (let i = 0; i < rows.length; ) {
    const row = rows[i];
    if (!row.changed) {
      if (row.left) {
        body.appendChild(
          unifiedRow(row.left, " ", [`${row.left.n}`, `${row.right?.n ?? ""}`]),
        );
      }
      i += 1;
      continue;
    }
    const run: Row[] = [];
    while (i < rows.length && rows[i].changed) run.push(rows[i++]);
    for (const r of run) {
      if (r.left) body.appendChild(unifiedRow(r.left, "-", [`${r.left.n}`, ""]));
    }
    for (const r of run) {
      if (r.right) {
        body.appendChild(unifiedRow(r.right, "+", ["", `${r.right.n}`]));
      }
    }
  }

  table.appendChild(body);
  return table;
}

function picker(options: DiffOption[], selected: string): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "diff-pick";
  for (const o of options) select.append(new Option(o.label, o.id));
  select.value = selected;
  return select;
}

const LAYOUT_KEY = "shelly-devroom.diff.unified";

function storedUnified(): boolean {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberUnified(on: boolean): void {
  try {
    localStorage.setItem(LAYOUT_KEY, on ? "1" : "0");
  } catch {
    /* the toggle still works for this session */
  }
}

let dialog: HTMLDialogElement | null = null;

export function openDiffModal(opts: {
  options: DiffOption[];
  left: string;
  right: string;
  load: DiffLoader;
}): void {
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "diff-modal";
    // Clicking the backdrop lands on the dialog itself, never on its children.
    dialog.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target === dialog || target.classList.contains("diff-close")) {
        dialog?.close();
      }
    });
    document.body.appendChild(dialog);
  }
  const modal = dialog;

  const churn = document.createElement("p");
  churn.className = "diff-churn";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "diff-close";
  close.textContent = "close";

  let unified = storedUnified();
  const layout = document.createElement("button");
  layout.type = "button";
  layout.className = "diff-layout";

  const left = picker(opts.options, opts.left);
  const right = picker(opts.options, opts.right);

  const head = document.createElement("div");
  head.className = "diff-head";
  head.append(churn, layout, close);

  const labels = document.createElement("div");
  labels.className = "diff-labels";
  labels.append(left, right);

  const scroll = document.createElement("div");
  scroll.className = "diff-scroll";

  modal.replaceChildren(head, labels, scroll);

  /** Only the newest render may paint: picks can outrun a slow load. */
  let generation = 0;
  /** Kept so a layout flip need not re-fetch either side. */
  let rows: Row[] = [];

  function paint() {
    layout.textContent = unified ? "side by side" : "unified";
    layout.title = unified
      ? "Switch to two columns"
      : "Switch to one column, the way a patch reads";
    // Even stacked in one column the pickers still read left-to-right as
    // "from" and "to", so they stay put across both layouts.
    labels.classList.toggle("stacked", unified);
    scroll.replaceChildren(unified ? buildUnified(rows) : buildTable(rows));
  }

  async function render() {
    const mine = ++generation;
    churn.textContent = "comparing…";
    let texts: [string, string];
    try {
      texts = await Promise.all([
        opts.load(left.value),
        opts.load(right.value),
      ]);
    } catch (e) {
      if (mine === generation) {
        churn.textContent = e instanceof Error ? e.message : String(e);
      }
      return;
    }
    if (mine !== generation) return;

    rows = pair(texts[0].split("\n"), texts[1].split("\n"));
    const removed = rows.filter((r) => r.changed && r.left).length;
    const added = rows.filter((r) => r.changed && r.right).length;
    churn.textContent = added + removed
      ? `+${added} −${removed} · ${rows.length} rows`
      : `identical · ${rows.length} rows`;
    paint();
    scroll.scrollTop = 0;
  }

  left.addEventListener("change", () => void render());
  right.addEventListener("change", () => void render());
  layout.addEventListener("click", () => {
    unified = !unified;
    rememberUnified(unified);
    paint();
  });

  modal.showModal();
  void render();
}
