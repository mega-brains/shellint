import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "./cm-setup";
import { devroomTheme } from "./cm-theme";
import { findingGutter } from "./finding-gutter";
import { dirtyGutter } from "./dirty-gutter";
import { statLineHighlight } from "./line-highlight";
import { diffHighlight } from "../diff/diff";
import { shellyHover } from "./hover-docs";
import { buildErrorGutter } from "./build-error-gutter";
import {
  createArtifactController,
  readOnlyCompartment,
  type ArtifactController,
  type ArtifactOption,
} from "./artifact-logic";
import { DiffModal, type DiffOption } from "../diff/diff-modal";
import { ButtonDropdown, Button } from "../ui/button";
import { api } from "../lib/api";

/** `debug.js` → `debug.min`, `prod.raw.js` → `prod.raw` — chip-sized names. */
function chipLabel(value: string): string {
  if (value === "source") return "source";
  const base = value.replace(/\.js$/, "");
  return /\.(raw|adv)$/.test(base) ? base : `${base}.min`;
}

export { readOnlyCompartment };
export type { ArtifactInfo } from "./artifact-logic";

export type EditorHostProps = {
  onView: (view: EditorView) => void;
  onDocChange: () => void;
  onStatus: (msg: string, isError?: boolean) => void;
  onPreview: (previewing: boolean) => void;
  onArtifactsReady?: (api: {
    refresh: () => Promise<void>;
    previewing: () => boolean;
  }) => void;
  /** Notice strip above the artifact bar — currently the imported-code banner. */
  banner?: ComponentChildren;
};

/**
 * CodeMirror mounts into a host Preact does not paint children into.
 * Artifact bar is declarative Preact; CM doc switching stays in the controller.
 */
export function EditorHost(props: EditorHostProps) {
  const cmRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const ctlRef = useRef<ArtifactController | null>(null);
  const onDocChange = useRef(props.onDocChange);
  onDocChange.current = props.onDocChange;
  const propsRef = useRef(props);
  propsRef.current = props;

  const [options, setOptions] = useState<ArtifactOption[]>([
    { value: "source", label: "source (editable)" },
  ]);
  const [current, setCurrent] = useState("source");
  const [meta, setMeta] = useState("");
  const [metaPreview, setMetaPreview] = useState(false);
  const [selectBusy, setSelectBusy] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffOpenMenu, setDiffOpenMenu] = useState(false);
  const [diffSpec, setDiffSpec] = useState<{
    options: DiffOption[];
    left: string;
    right: string;
  } | null>(null);

  const loadDiff = useCallback(async (id: string) => {
    return ctlRef.current?.loadDiff(id) ?? "";
  }, []);

  useEffect(() => {
    if (!cmRef.current || viewRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: "// loading…\n",
        extensions: [
          basicSetup,
          javascript({ typescript: true }),
          readOnlyCompartment.of([]),
          findingGutter,
          dirtyGutter,
          statLineHighlight,
          diffHighlight,
          shellyHover,
          buildErrorGutter,
          devroomTheme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onDocChange.current();
          }),
        ],
      }),
      parent: cmRef.current,
    });
    viewRef.current = view;
    propsRef.current.onView(view);

    const artifacts = createArtifactController({
      view,
      api,
      onStatus: (msg, isError) => propsRef.current.onStatus(msg, isError),
      onPreview: () =>
        propsRef.current.onPreview(ctlRef.current?.previewing() ?? false),
      onMeta: (text, previewing) => {
        setMeta(text);
        setMetaPreview(previewing);
      },
      onOptions: (opts, cur) => {
        setOptions(opts);
        setCurrent(cur);
        setSelectBusy(false);
      },
      onDiff: (spec) => {
        setDiffSpec(spec);
        setDiffOpen(true);
      },
    });
    ctlRef.current = artifacts;
    propsRef.current.onArtifactsReady?.(artifacts);

    return () => {
      artifacts.dispose();
      view.destroy();
      viewRef.current = null;
      ctlRef.current = null;
    };
  }, []);

  const chips = options.filter((o) => !o.value.startsWith("diff:"));
  const diffs = options.filter((o) => o.value.startsWith("diff:"));

  return (
    <div id="editor" class="editor panel">
      <div class="artifact-strip">
        {chips.map((o) => (
          <Button
            key={o.value}
            class={`artifact-chip${current === o.value ? " active" : ""}`}
            data-value={o.value}
            aria-pressed={current === o.value ? "true" : "false"}
            title={o.label}
            disabled={selectBusy}
            onClick={() => {
              setSelectBusy(true);
              setCurrent(o.value);
              ctlRef.current?.select(o.value);
            }}
          >
            {chipLabel(o.value)}
          </Button>
        ))}
        {diffs.length ? (
          <ButtonDropdown
            rootId="diffSplit"
            toggleId="btnDiffMenu"
            menuId="diffMenu"
            className="split artifact-diff"
            open={diffOpenMenu}
            onOpenChange={setDiffOpenMenu}
            toggleTitle="Compare two built artifacts"
            onPick={(item) => {
              const value = item.dataset.value!;
              setSelectBusy(true);
              setCurrent(value);
              ctlRef.current?.select(value);
            }}
            primary={
              <Button
                class={`artifact-chip${current.startsWith("diff:") ? " active" : ""}`}
                title="Compare two built artifacts"
                disabled={selectBusy}
                onClick={() => setDiffOpenMenu((o) => !o)}
              >
                diff
              </Button>
            }
            menu={
              <ul class="menu" id="diffMenu" role="menu">
                {diffs.map((o) => (
                  <li role="none" key={o.value}>
                    <Button role="menuitem" data-value={o.value} title={o.label}>
                      {o.label.replace(/^diff · /, "")}
                    </Button>
                  </li>
                ))}
              </ul>
            }
          />
        ) : null}
        <span class="strip-spacer" />
        <p
          class={`artifact-meta${metaPreview ? " preview" : ""}`}
          id="artifactMeta"
        >
          {meta}
        </p>
      </div>
      <div class="editor-body">
        {props.banner}
        <div class="cm-host" ref={cmRef} />
      </div>
      {diffSpec ? (
        <DiffModal
          open={diffOpen}
          options={diffSpec.options}
          left={diffSpec.left}
          right={diffSpec.right}
          load={loadDiff}
          onClose={() => setDiffOpen(false)}
        />
      ) : null}
    </div>
  );
}
