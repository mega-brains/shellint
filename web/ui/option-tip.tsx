import {
  Component,
  render,
  type ComponentChildren,
  type JSX,
  type VNode,
} from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

export type OptTipContent = {
  name: string;
  blurb: string;
  /** Unified-diff style lines (without leading +/-). */
  before: string[];
  after: string[];
};

/**
 * Real DOM host on document.body (not a FakeParent proxy).
 * Host is a top-layer fixed shell so tips cannot lose to #side gauges.
 */
export class BodyPortal extends Component<{ children: ComponentChildren }> {
  private host: HTMLDivElement | null = null;

  private ensureHost(): HTMLDivElement {
    if (!this.host) {
      const host = document.createElement("div");
      host.setAttribute("data-tip-portal", "");
      // Own stacking context above #app / #side; clicks pass through.
      host.style.cssText =
        "position:fixed;inset:0;z-index:10000;pointer-events:none;";
      document.body.appendChild(host);
      this.host = host;
    }
    return this.host;
  }

  componentWillUnmount() {
    if (this.host) {
      render(null, this.host);
      this.host.remove();
      this.host = null;
    }
  }

  render() {
    const host = this.ensureHost();
    render(this.props.children as VNode, host);
    return null;
  }
}

/** Tip copy for each minify checkbox — shown immediately on hover/focus. */
export const OPT_TIPS: Record<string, OptTipContent> = {
  compress: {
    name: "compress",
    blurb:
      "Terser’s compress pass on tier-2 (*.js): dead code, constant folding, and simpler control flow. Uses safe defaults only.",
    before: ["if (ok) {", "  return n + 1;", "}"],
    after: ["return ok ? n + 1 : void 0;"],
  },
  mangle: {
    name: "mangle",
    blurb:
      "Shortens local names and parameters. Never renames object keys — Shelly RPC fields like id / on stay intact.",
    before: ["function tick(elapsed) {", "  return elapsed / 1000;", "}"],
    after: ["function tick(e) {", "  return e / 1e3;", "}"],
  },
  toplevel: {
    name: "toplevel",
    blurb:
      "Also minify names at script scope. Shelly runs one top-level scope, so this is the biggest size win — and the riskiest if something is resolved by name.",
    before: ["var counter = 0;", "function scanCB() {}"],
    after: ["var c = 0;", "function _() {}"],
  },
  keepFnames: {
    name: "keep fnames",
    blurb:
      "When mangling (especially with toplevel), keep function names readable for traces while variables still shorten.",
    before: ["function _() {}", "var c = 0;"],
    after: ["function scanCB() {}", "var c = 0;"],
  },
  logMap: {
    name: "prod log map",
    blurb:
      "Prod build: replace long print/console strings (including string pieces in + chains) with short ids and write dist/prod.logmap.json so the logs panel can expand them again.",
    before: ['print(P + "motion detected ");'],
    after: ['print(P + "L1 ");'],
  },
  debugLogMap: {
    name: "debug log map",
    blurb:
      "Also run the same log-string shortening on the debug artifact. Off by default so debug keeps readable strings; enable when you want the map on debug builds too.",
    before: ['console.log("debug path taken here");'],
    after: ['console.log("L1");'],
  },
  advanced: {
    name: "advanced minify",
    blurb:
      "Tier-3: run espruino --minify on the already-Tersered *.js to emit *.adv.js. Skipped when off or when the CLI is missing.",
    before: ["dist/prod.js"],
    after: ["dist/prod.adv.js"],
  },
  dropConsole: {
    name: "drop console",
    blurb:
      "Prod only, never debug: Terser deletes every console.* call outright instead of shortening its string. Measured −4.4% on prod. Applies to prod.raw.js and prod.js alike, and works even with compress off. print() calls (including the #m metric channel) are untouched — this only removes console.*.",
    before: ['console.log("polled status", st);'],
    after: ["/* dropped */"],
  },
  passes: {
    name: "3 compress passes",
    blurb:
      "Run Terser's compress step 3 times instead of once, so later passes can clean up what earlier ones exposed. ~0 on the current demo script, costs 2–3× the Terser wall time — worth trying on larger real scripts.",
    before: ["1 compress pass"],
    after: ["3 compress passes"],
  },
  hoistProps: {
    name: "hoist props",
    blurb:
      "Terser inlines properties of object literals it can prove never escape the script. Measured 0 B on the current demo — it only pays off on scripts with larger non-escaping config objects.",
    before: ["var cfg = { a: 1 };", "f(cfg.a);"],
    after: ["var cfg_a = 1;", "f(cfg_a);"],
  },
  deviceDCE: {
    name: "device DCE",
    blurb:
      "Extends the meta.env build-time substitution with meta.device.gen / model / fw, read from types/device-profile.json, so a generation-gated branch is dead-code-eliminated at build time. A missing or partial profile substitutes nothing for that field (never undefined) and prints a build warning. Artifacts become device-specific.",
    before: ["if (meta.device.gen >= 3) {", "  useMatter();", "}"],
    after: ["useMatter();"],
  },
  internStrings: {
    name: "intern strings",
    blurb:
      "Hoist repeated string literals (RPC method names like Switch.Set) into a top-level var, one per repeat instead of paying for the whole literal each time. Only applied when the math says it saves bytes — skipped on the current demo script (its four repeats are all below break-even), pays off on scripts with more repeated RPC calls.",
    before: ['Shelly.call("Switch.Set", a);', 'Shelly.call("Switch.Set", b);'],
    after: ['var V1="Switch.Set";', "Shelly.call(V1, a);", "Shelly.call(V1, b);"],
  },
};

export type OptTipProps = {
  content: OptTipContent;
  style: JSX.CSSProperties;
  /** When false, tip is not rendered. */
  open: boolean;
};

/**
 * Pull a rendered tip back inside the viewport. `tipStyleFor` runs before the
 * tip exists, so it can only guess at the height; the last options in the list
 * sit low enough that a tall tip runs off the bottom, and the portal host is
 * `pointer-events: none` so there is nothing to scroll. Idempotent — safe to
 * re-run on every render.
 */
export function clampTipTop(el: HTMLElement, gap = 8): void {
  const vh = window.innerHeight;
  const height = el.offsetHeight;
  const top = el.getBoundingClientRect().top;
  const wanted = Math.max(gap, Math.min(top, vh - gap - height));
  if (Math.abs(wanted - top) >= 1) el.style.top = `${wanted}px`;
}

/** Fixed, non-interactive tip card (diff tint via existing .diff-del / .diff-add). */
export function OptTip(props: OptTipProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  // No dep array: content and anchor both change without the node remounting.
  useLayoutEffect(() => {
    if (ref.current) clampTipTop(ref.current);
  });

  if (!props.open) return null;
  return (
    <BodyPortal>
      <div
        ref={ref}
        class="opt-tip"
        style={props.style}
        role="tooltip"
        data-testid="opt-tip"
      >
        <p class="opt-tip-name">{props.content.name}</p>
        <p class="opt-tip-blurb">{props.content.blurb}</p>
        {/* Rules with no fixed code shape (the inputs group, the dynamic
            capability checks) carry no example — dropping the block entirely
            beats rendering an empty tinted strip under the blurb. */}
        {props.content.before.length || props.content.after.length ? (
        <div class="opt-tip-diff" aria-hidden="true">
          {props.content.before.map((line, i) => (
            <div key={`b${i}`} class="opt-tip-line diff-del">
              <span class="diff-sign">−</span>
              <code>{line}</code>
            </div>
          ))}
          {props.content.after.map((line, i) => (
            <div key={`a${i}`} class="opt-tip-line diff-add">
              <span class="diff-sign">+</span>
              <code>{line}</code>
            </div>
          ))}
        </div>
        ) : null}
      </div>
    </BodyPortal>
  );
}

/**
 * Place tip to the left of the anchor, clamped so its right edge stays in the
 * editor column (left of #side) — never over sidebar gauges.
 */
export function tipStyleFor(anchor: DOMRect, tipW = 288): JSX.CSSProperties {
  const gap = 8;
  const side = document.getElementById("side");
  const sideLeft = side?.getBoundingClientRect().left ?? window.innerWidth;
  const maxRight = sideLeft - gap;
  const width = Math.min(tipW, Math.max(160, maxRight - gap));

  let left = anchor.left - width - gap;
  if (left + width > maxRight) left = maxRight - width;

  // Height is unknown until the tip renders — cap it here, then `clampTipTop`
  // pulls the box up once the real height is measurable.
  const maxHeight = Math.max(120, window.innerHeight - gap * 2);

  if (left >= gap) {
    return {
      top: Math.max(gap, anchor.top - 4),
      left,
      width,
      maxHeight,
    };
  }

  // Not enough room to the left — flip below, still clamped to editor column.
  return {
    top: anchor.bottom + gap,
    left: Math.max(gap, Math.min(anchor.left, maxRight - width)),
    width: Math.min(width, Math.max(160, maxRight - gap)),
    maxHeight,
  };
}
