/**
 * CodeMirror theme on the design tokens (M18). CodeMirror's DOM is not ours to
 * restyle from a stylesheet reliably (its own theme rules win on specificity),
 * so the editor surface is themed here — but every colour is a `var(--…)`, so
 * dark/light still comes from one place, `web/shell/styles.css`.
 */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const theme = EditorView.theme({
  "&": {
    height: "100%",
    width: "100%",
    color: "var(--code-ink)",
    backgroundColor: "var(--surface)",
    fontSize: "12.5px",
  },
  ".cm-content": {
    caretColor: "var(--accent)",
    padding: "8px 0 0 14px",
    lineHeight: "1.62",
  },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--mono)", lineHeight: "1.62" },
  ".cm-gutters": {
    minWidth: "52px",
    border: "none",
    color: "var(--gutter-ink)",
    backgroundColor: "var(--surface-3)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 0", minWidth: "0" },
  ".cm-gutters .cm-gutterElement": { lineHeight: "1.62" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--surface-2) 55%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--muted)" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 26%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in srgb, var(--accent) 18%, transparent)",
  },
  ".cm-matchingBracket, .cm-nonmatchingBracket": {
    backgroundColor: "var(--surface-2)",
    outline: "none",
  },
  ".cm-panels": { backgroundColor: "var(--surface-2)", color: "var(--ink)" },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--warn) 30%, transparent)",
  },
  ".cm-tooltip": {
    border: "none",
    borderRadius: "8px",
    backgroundColor: "var(--surface-2)",
    color: "var(--ink)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-ink)",
  },
  ".cm-foldGutter .cm-gutterElement": { color: "var(--faint)" },
});

const highlight = HighlightStyle.define([
  { tag: t.comment, color: "var(--faint)", fontStyle: "italic" },
  {
    tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword],
    color: "var(--code-keyword)",
  },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--code-string)" },
  { tag: [t.number, t.bool, t.null], color: "var(--ok)" },
  // Functions and the Shelly/Espruino globals the script actually talks to.
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--accent)" },
  { tag: [t.standard(t.variableName), t.className, t.namespace], color: "var(--accent)" },
  { tag: [t.propertyName, t.variableName], color: "var(--code-ink)" },
  { tag: [t.typeName, t.typeOperator], color: "var(--muted)" },
  { tag: t.invalid, color: "var(--danger)" },
]);

export const shellintTheme: Extension = [theme, syntaxHighlighting(highlight)];
