/**
 * Hover tooltips for Shelly/Espruino API identifiers, sourced from JSDoc in
 * types/shelly.d.ts + types/espruino-lib.d.ts (extracted by
 * scripts/gen-api-docs.mjs into types/api-docs.json).
 */
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import { cmHost } from "./cm-host";

interface DocEntry {
  signature: string;
  doc: string;
  doc_url?: string;
}

interface ApiDocs {
  entries: Record<string, DocEntry>;
  byBareName: Record<string, string>;
}

/**
 * 27 KB of JSON that only ever renders on hover, so it is fetched alongside the
 * bundle rather than inlined into it. `hoverTooltip` is synchronous — until the
 * fetch lands, lookups simply miss and no tooltip appears.
 */
let docs: ApiDocs = { entries: {}, byBareName: {} };

fetch("/api-docs.json")
  .then((res) => (res.ok ? (res.json() as Promise<ApiDocs>) : null))
  .then((loaded) => {
    if (loaded) docs = loaded;
  })
  .catch(() => {
    /* tooltips stay empty; the editor is unaffected */
  });

const WORD_CHAR = /[A-Za-z0-9_$]/;

function wordAt(text: string, pos: number): { from: number; to: number; text: string } | null {
  let from = pos;
  let to = pos;
  while (from > 0 && WORD_CHAR.test(text[from - 1])) from--;
  while (to < text.length && WORD_CHAR.test(text[to])) to++;
  if (from === to) return null;
  return { from, to, text: text.slice(from, to) };
}

function lookup(lineText: string, word: { from: number; to: number; text: string }): DocEntry | null {
  const before = lineText[word.from - 1];
  if (before === ".") {
    let j = word.from - 2;
    while (j >= 0 && WORD_CHAR.test(lineText[j])) j--;
    const receiver = lineText.slice(j + 1, word.from - 1);
    const dotted = receiver && docs.entries[`${receiver}.${word.text}`];
    if (dotted) return dotted;
  }
  if (docs.entries[word.text]) return docs.entries[word.text];
  const viaBare = docs.byBareName[word.text];
  return viaBare ? (docs.entries[viaBare] ?? null) : null;
}

function HoverBody(props: { entry: DocEntry }) {
  const { entry } = props;
  return (
    <>
      <code class="cm-shelly-hover-sig">{entry.signature}</code>
      {entry.doc ? <div class="cm-shelly-hover-doc">{entry.doc}</div> : null}
      {entry.doc_url ? (
        <a
          class="cm-shelly-hover-link"
          href={entry.doc_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          docs ↗
        </a>
      ) : null}
    </>
  );
}

export const shellyHover = hoverTooltip((view, pos): Tooltip | null => {
  const line = view.state.doc.lineAt(pos);
  const word = wordAt(line.text, pos - line.from);
  if (!word) return null;

  const entry = lookup(line.text, word);
  if (!entry) return null;

  return {
    pos: line.from + word.from,
    end: line.from + word.to,
    above: true,
    create() {
      return {
        dom: cmHost("div", {
          class: "cm-shelly-hover",
          children: <HoverBody entry={entry} />,
        }),
      };
    },
  };
});
