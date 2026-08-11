/**
 * Hover tooltips for Shelly/Espruino API identifiers, sourced from JSDoc in
 * types/shelly.d.ts + types/espruino-lib.d.ts (extracted by
 * scripts/gen-api-docs.mjs into types/api-docs.json).
 */
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import apiDocs from "../types/api-docs.json";

interface DocEntry {
  signature: string;
  doc: string;
  doc_url?: string;
}

interface ApiDocs {
  entries: Record<string, DocEntry>;
  byBareName: Record<string, string>;
}

const docs = apiDocs as ApiDocs;

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
      const dom = document.createElement("div");
      dom.className = "cm-shelly-hover";

      const sig = document.createElement("code");
      sig.className = "cm-shelly-hover-sig";
      sig.textContent = entry.signature;
      dom.appendChild(sig);

      if (entry.doc) {
        const doc = document.createElement("div");
        doc.className = "cm-shelly-hover-doc";
        doc.textContent = entry.doc;
        dom.appendChild(doc);
      }

      if (entry.doc_url) {
        const link = document.createElement("a");
        link.className = "cm-shelly-hover-link";
        link.href = entry.doc_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "docs ↗";
        dom.appendChild(link);
      }

      return { dom };
    },
  };
});
