/*
 * A deliberately tiny highlighter for the one-line code snippets in the checks
 * page's example cards (`web/site/checks.tsx`).
 *
 * The site ships no editor — CodeMirror lives in the app bundle and stays
 * there (`scripts/test-static-bundle.mjs` fails the build if a "cm-content"
 * marker ever shows up in site.js), so a real Lezer parse is not on the table
 * for ~120 short lines of device JS. This is one regex over one line.
 *
 * Colours match `web/editor/cm-theme.ts` exactly — comments `--faint` italic,
 * strings `--code-string`, keywords `--code-keyword` — so a snippet on the
 * site reads the same as the same code in the editor.
 *
 * Regex literals are left uncoloured on purpose: telling `/^\d+$/` from a
 * division needs the parse this file is avoiding, and guessing wrong would
 * swallow the rest of the line into a fake "string".
 */
import type { ComponentChildren } from "preact";

/** The subset that actually appears in `web/check/check-tips.ts` snippets. */
const KEYWORDS = [
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "new",
  "typeof",
  "class",
  "import",
  "from",
  "async",
  "await",
  "yield",
  "with",
  "break",
  "get",
  "set",
  "null",
  "true",
  "false",
];

/**
 * Order matters: comments and strings are matched before keywords, so `// var`
 * stays a comment and `"function"` stays a string. Within a line the scan is
 * left to right, so a `//` inside a string literal is consumed by the string
 * (the quote comes first) rather than starting a comment.
 */
const TOKEN = new RegExp(
  [
    "(/\\*[\\s\\S]*?\\*/|//[^\\n]*)", // 1: comment (block or line)
    "(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)", // 2: string
    `\\b(${KEYWORDS.join("|")})\\b`, // 3: keyword
  ].join("|"),
  "g",
);

const CLASS = ["tok-comment", "tok-string", "tok-keyword"];

/** Snippet line → the same text, with comments/strings/keywords wrapped. */
export function highlight(line: string): ComponentChildren {
  const out: ComponentChildren[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(line.slice(last, at));
    // Exactly one of the three groups matched — its index picks the class.
    const group = CLASS.findIndex((_, i) => m[i + 1] !== undefined);
    out.push(<span class={CLASS[group]}>{m[0]}</span>);
    last = at + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}
