import type { ComponentChildren } from "preact";

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
};

/** Uppercase caption + optional right-hand unit note, then the group's body. */
export function Group(props: GroupProps) {
  return (
    <section class="group" id={props.id}>
      <div class="group-head">
        <h2 class="group-title">{props.title}</h2>
        {props.caption != null ? (
          <span class="group-caption">{props.caption}</span>
        ) : null}
      </div>
      {props.children}
    </section>
  );
}
