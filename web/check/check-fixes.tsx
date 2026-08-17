import { useState } from "preact/hooks";
import { DiffModal } from "../diff/diff-modal";
import type { CheckFixPreview } from "./check-types";

export function CheckFixesButton(props: {
  fixes: CheckFixPreview | null;
  onApply: (fixes: CheckFixPreview) => Promise<void>;
  compact?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const fixes = props.fixes;
  if (!fixes) return null;

  const options = [
    { id: "before", label: "saved source" },
    { id: "after", label: `${fixes.count} automatic fix${fixes.count === 1 ? "" : "es"}` },
  ];
  return (
    <>
      <button
        type="button"
        class={props.compact ? "finding-fix" : "fix-findings"}
        title={props.title ?? `Preview ${fixes.count} safe automatic fix${fixes.count === 1 ? "" : "es"}`}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        {props.compact ? "fix" : "◫ preview fixes"}
      </button>
      <DiffModal
        open={open}
        options={options}
        left="before"
        right="after"
        load={async (id) => (id === "before" ? fixes.before : fixes.after)}
        onClose={() => setOpen(false)}
        actions={
          <>
            {error ? <span class="fix-error">{error}</span> : null}
            <button
              type="button"
              class="btn-primary diff-apply-fixes"
              disabled={applying}
              onClick={() => {
                setApplying(true);
                setError("");
                void props
                  .onApply(fixes)
                  .then(
                    () => setOpen(false),
                    (cause) =>
                      setError(cause instanceof Error ? cause.message : String(cause)),
                  )
                  .finally(() => setApplying(false));
              }}
            >
              {applying ? "applying…" : `apply ${fixes.count} fixes`}
            </button>
          </>
        }
      />
    </>
  );
}
