import { render, type ComponentChildren } from "preact";

type HostTag = "div" | "span";

type HostProps = {
  class?: string;
  hidden?: boolean;
  title?: string;
  "aria-label"?: string;
  children?: ComponentChildren;
};

/**
 * One real DOM node for CodeMirror marker/tooltip APIs.
 * Children are Preact/JSX — no hand-rolled multi-child createElement trees.
 */
export function cmHost(tag: HostTag, props: HostProps = {}): HTMLElement {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.hidden) el.hidden = true;
  if (props.title) el.title = props.title;
  if (props["aria-label"]) el.setAttribute("aria-label", props["aria-label"]);
  if (props.children != null) render(<>{props.children}</>, el);
  return el;
}

/** Re-render JSX into an existing CM/body host (e.g. shared tooltips). */
export function cmRender(host: HTMLElement, children: ComponentChildren): void {
  render(<>{children}</>, host);
}
