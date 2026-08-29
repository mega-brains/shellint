/*
 * The site's inline-markup renderer, shared by `docs.tsx` and `faq.tsx`.
 *
 * Exactly three forms (`code`, [label](href), **bold**) — the three the copy
 * uses. Anything richer means shipping a Markdown parser to a site with no
 * runtime dependency beyond Preact.
 *
 * Extracted from docs.tsx when the FAQ became its own page: the alternative
 * was faq.tsx importing a page component to reach a helper.
 */
import type { ComponentChildren } from "preact";

const INLINE = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;

export function renderInline(text: string): ComponentChildren {
  const out: ComponentChildren[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1] !== undefined) {
      out.push(<code>{m[1]}</code>);
    } else if (m[2] !== undefined && m[3] !== undefined) {
      const external = m[3].startsWith("http");
      out.push(
        <a href={m[3]} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
          {m[2]}
        </a>,
      );
    } else {
      out.push(<strong>{m[4]}</strong>);
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
