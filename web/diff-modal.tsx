import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
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

function CodeCell(props: {
  value: NonNullable<Cell>;
  side: "del" | "add";
}) {
  if (!props.value.parts) return <>{props.value.text}</>;
  return (
    <>
      {props.value.parts.map((part, i) =>
        part.changed ? (
          <span key={i} class={`diff-word diff-word-${props.side}`}>
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function sideCells(
  value: Cell,
  changed: boolean,
  side: "del" | "add",
): ComponentChildren[] {
  if (!value) {
    return [
      <td class="diff-num diff-blank" />,
      <td class="diff-code diff-blank" />,
    ];
  }
  return [
    <td class="diff-num">{`${value.n}`}</td>,
    <td class={`diff-code${changed ? ` diff-${side}` : ""}`}>
      <CodeCell value={value} side={side} />
    </td>,
  ];
}

function SideBySideTable(props: { rows: Row[] }) {
  return (
    <table class="diff-table">
      <tbody>
        {props.rows.map((row, i) => (
          <tr key={i}>
            {sideCells(row.left, row.changed, "del")}
            {sideCells(row.right, row.changed, "add")}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UnifiedRow(props: {
  value: NonNullable<Cell>;
  sign: " " | "+" | "-";
  nums: [string, string];
}) {
  const side = props.sign === "-" ? "del" : "add";
  const tint = props.sign !== " ";
  return (
    <tr>
      <td class="diff-num">{props.nums[0]}</td>
      <td class="diff-num">{props.nums[1]}</td>
      <td class={`diff-sign${tint ? ` diff-${side}` : ""}`}>{props.sign}</td>
      <td class={`diff-code${tint ? ` diff-${side}` : ""}`}>
        <CodeCell value={props.value} side={side} />
      </td>
    </tr>
  );
}

function UnifiedTable(props: { rows: Row[] }) {
  const out: ComponentChildren[] = [];
  for (let i = 0; i < props.rows.length; ) {
    const row = props.rows[i];
    if (!row.changed) {
      if (row.left) {
        out.push(
          <UnifiedRow
            key={`u-${i}`}
            value={row.left}
            sign=" "
            nums={[`${row.left.n}`, `${row.right?.n ?? ""}`]}
          />,
        );
      }
      i += 1;
      continue;
    }
    const run: Row[] = [];
    while (i < props.rows.length && props.rows[i].changed) {
      run.push(props.rows[i++]);
    }
    for (const r of run) {
      if (r.left) {
        out.push(
          <UnifiedRow
            key={`d-${r.left.n}`}
            value={r.left}
            sign="-"
            nums={[`${r.left.n}`, ""]}
          />,
        );
      }
    }
    for (const r of run) {
      if (r.right) {
        out.push(
          <UnifiedRow
            key={`a-${r.right.n}`}
            value={r.right}
            sign="+"
            nums={["", `${r.right.n}`]}
          />,
        );
      }
    }
  }
  return (
    <table class="diff-table diff-unified">
      <tbody>{out}</tbody>
    </table>
  );
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

export type DiffModalProps = {
  open: boolean;
  options: DiffOption[];
  left: string;
  right: string;
  load: DiffLoader;
  onClose: () => void;
};

export function DiffModal(props: DiffModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [leftId, setLeftId] = useState(props.left);
  const [rightId, setRightId] = useState(props.right);
  const [unified, setUnified] = useState(storedUnified);
  const [churn, setChurn] = useState("comparing…");
  const [rows, setRows] = useState<Row[]>([]);
  const gen = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (props.open) {
      setLeftId(props.left);
      setRightId(props.right);
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [props.open, props.left, props.right]);

  useEffect(() => {
    if (!props.open) return;
    const mine = ++gen.current;
    setChurn("comparing…");
    void (async () => {
      try {
        const texts = await Promise.all([
          props.load(leftId),
          props.load(rightId),
        ]);
        if (mine !== gen.current) return;
        const next = pair(texts[0].split("\n"), texts[1].split("\n"));
        setRows(next);
        const removed = next.filter((r) => r.changed && r.left).length;
        const added = next.filter((r) => r.changed && r.right).length;
        setChurn(
          added + removed
            ? `+${added} −${removed} · ${next.length} rows`
            : `identical · ${next.length} rows`,
        );
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      } catch (e) {
        if (mine === gen.current) {
          setChurn(e instanceof Error ? e.message : String(e));
        }
      }
    })();
  }, [props.open, leftId, rightId, props.load]);

  return (
    <dialog
      ref={dialogRef}
      class="diff-modal"
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target === dialogRef.current || target.classList.contains("diff-close")) {
          props.onClose();
        }
      }}
      onClose={props.onClose}
    >
      <div class="diff-head">
        <p class="diff-churn">{churn}</p>
        <button
          type="button"
          class="diff-layout"
          title={
            unified
              ? "Switch to two columns"
              : "Switch to one column, the way a patch reads"
          }
          onClick={() => {
            const next = !unified;
            setUnified(next);
            rememberUnified(next);
          }}
        >
          {unified ? "side by side" : "unified"}
        </button>
        <button type="button" class="diff-close">
          close
        </button>
      </div>
      <div class={`diff-labels${unified ? " stacked" : ""}`}>
        <select
          class="diff-pick"
          value={leftId}
          onChange={(e) => setLeftId((e.target as HTMLSelectElement).value)}
        >
          {props.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          class="diff-pick"
          value={rightId}
          onChange={(e) => setRightId((e.target as HTMLSelectElement).value)}
        >
          {props.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div class="diff-scroll" ref={scrollRef}>
        {unified ? (
          <UnifiedTable rows={rows} />
        ) : (
          <SideBySideTable rows={rows} />
        )}
      </div>
    </dialog>
  );
}
