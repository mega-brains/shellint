import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

function readCollapsed(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writeCollapsed(key: string, collapsed: boolean) {
  try {
    localStorage.setItem(key, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * The inspector's one data-display grammar (M18): a labelled bar with its
 * number, used for artifact sizes, capped resources and memory buckets alike,
 * so bars are comparable down a column instead of each group inventing its own
 * treatment. Colour is not decoration here — a bar only leaves the neutral fill
 * when it is the targeted artifact, or at/over 75% of a real limit.
 */
export type Tone = "neutral" | "accent" | "warn" | "danger";

/** ≥75% of a limit is where a bar stops being informational. */
export const WARN_FRACTION = 0.75;

export type MeasureRowProps = {
  label: string;
  /** Right-hand number, already formatted ("5324 B", "0/5"). */
  value: string;
  /** 0–1 of the group's scale. */
  fraction: number;
  tone?: Tone;
  title?: string;
  /** Spoken form of the whole row — every bar carries one. */
  ariaLabel: string;
  /** Italicises the label: an advisory limit, not a firmware cap. */
  soft?: boolean;
};

export function MeasureRow(props: MeasureRowProps) {
  const pct = Math.max(0, Math.min(1, props.fraction)) * 100;
  const tone = props.tone ?? "accent";
  return (
    <li
      class={`measure${props.soft ? " soft" : ""}`}
      title={props.title}
      data-tone={tone}
    >
      <span class="measure-label">{props.label}</span>
      <div class="measure-track" role="img" aria-label={props.ariaLabel}>
        <div class={`measure-fill tone-${tone}`} style={{ width: `${pct.toFixed(1)}%` }} />
      </div>
      <span class="measure-value">{props.value}</span>
    </li>
  );
}

export type MeasureListProps = {
  id?: string;
  /** Width of the label column — 76px for sizes, 104px for cap names. */
  labelWidth?: number;
  /** Width of the value column. */
  valueWidth?: number;
  children: ComponentChildren;
};

export function MeasureList(props: MeasureListProps) {
  return (
    <ul
      class="measures"
      id={props.id}
      style={{
        "--measure-label": `${props.labelWidth ?? 76}px`,
        "--measure-value": `${props.valueWidth ?? 62}px`,
      }}
    >
      {props.children}
    </ul>
  );
}

export type GroupProps = {
  title: string;
  /** Right-aligned unit note in the same caption style ("used / limit"). */
  caption?: ComponentChildren;
  id?: string;
  children: ComponentChildren;
  /** When set, the body collapses behind a toggle, state kept in localStorage under this key. */
  collapseKey?: string;
  /** Collapsed state on first render when nothing is stored yet. */
  defaultCollapsed?: boolean;
};

/** Uppercase caption + optional right-hand unit note, then the group's body. */
export function Group(props: GroupProps) {
  const collapsible = props.collapseKey != null;
  const [collapsed, setCollapsed] = useState(() =>
    collapsible
      ? readCollapsed(props.collapseKey as string, props.defaultCollapsed ?? false)
      : false,
  );
  const bodyId = props.id ? `${props.id}Body` : undefined;

  return (
    <section class="group" id={props.id}>
      <div class="group-head">
        {collapsible ? (
          <button
            type="button"
            class="group-toggle"
            aria-expanded={collapsed ? "false" : "true"}
            aria-controls={bodyId}
            onClick={() => {
              const next = !collapsed;
              setCollapsed(next);
              writeCollapsed(props.collapseKey as string, next);
            }}
          >
            <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span> {props.title}
          </button>
        ) : (
          <h2 class="group-title">{props.title}</h2>
        )}
        {props.caption != null ? (
          <span class="group-caption">{props.caption}</span>
        ) : null}
      </div>
      {collapsible && collapsed ? null : (
        // `display: contents` so the body's children stay direct flex items of
        // `.group` and keep its 8px gap between them — a real box here collapses
        // every multi-child group by one gap per child. The element exists only
        // to give the toggle above an `aria-controls` target.
        <div id={bodyId} style={{ display: "contents" }}>
          {props.children}
        </div>
      )}
    </section>
  );
}
