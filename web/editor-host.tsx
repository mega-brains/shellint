import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "./cm-setup";
import { findingGutter } from "./finding-gutter";
import { dirtyGutter } from "./dirty-gutter";
import { statLineHighlight } from "./line-highlight";
import { diffHighlight } from "./diff";
import { shellyHover } from "./hover-docs";
import { buildErrorGutter } from "./build-error-gutter";
import {
  createArtifactController,
  readOnlyCompartment,
  type ArtifactController,
  type ArtifactOption,
} from "./artifact-logic";
import { DiffModal, type DiffOption } from "./diff-modal";
import { api } from "./api";

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
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onDocChange.current();
          }),
          EditorView.theme({
            "&": { height: "100%", width: "100%" },
            ".cm-scroller": { overflow: "auto" },
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

  return (
    <div id="editor" class="editor">
      <div class="artifact-bar">
        <span class="artifact-icon" aria-hidden="true">
          ◫
        </span>
        <label class="visually-hidden" for="artifactSel">
          view
        </label>
        <select
          id="artifactSel"
          title="Show the editable source, or preview a built dist artifact read-only"
          value={current}
          disabled={selectBusy}
          onChange={(e) => {
            const name = (e.target as HTMLSelectElement).value;
            setSelectBusy(true);
            setCurrent(name);
            ctlRef.current?.select(name);
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <p
          class={`artifact-meta${metaPreview ? " preview" : ""}`}
          id="artifactMeta"
        >
          {meta}
        </p>
      </div>
      <div class="cm-host" ref={cmRef} />
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
