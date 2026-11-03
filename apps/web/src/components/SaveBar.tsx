import SavedNote from "./SavedNote";

/**
 * The one way to save a settings section: the shared library's save bar. It shows only while there
 * are unsaved changes, sticks to the foot of the window while its section is in view, says how many
 * changes there are, and offers Save changes and Discard changes.
 *
 * Inside a form, Save changes submits the form, so the browser's own checks (required, min, max) run
 * first. Outside a form, pass onSave. Pass savedAt after a save: the bar goes and the library's saved
 * note, "Saved at 16:31", stays in its place until the next change (no toast on settings pages).
 */
export default function SaveBar({
  changes,
  saving = false,
  disabled = false,
  onSave,
  onDiscard,
  label = "Unsaved changes",
  savedAt,
  savedDetail,
}: {
  /** How many settings differ from the saved ones. */
  changes: number;
  saving?: boolean;
  /** Save is not possible yet, for example while a preview is still checking the change. */
  disabled?: boolean;
  onSave?: () => void;
  onDiscard: () => void;
  /** The bar's name for assistive technology, when a page has more than one. */
  label?: string;
  /** When the section was last saved, for the saved note. */
  savedAt?: Date | null;
  /** A sentence after "Saved at 16:31". */
  savedDetail?: string;
}) {
  const open = changes > 0 || saving;
  return (
    <>
      {open && (
        <Bar
          changes={changes}
          saving={saving}
          disabled={disabled}
          onSave={onSave}
          onDiscard={onDiscard}
          label={label}
        />
      )}
      {savedAt !== undefined && (
        <div className="save-bar-saved">
          <SavedNote at={open ? null : savedAt} detail={savedDetail} />
        </div>
      )}
    </>
  );
}

function Bar({
  changes,
  saving,
  disabled,
  onSave,
  onDiscard,
  label,
}: {
  changes: number;
  saving: boolean;
  disabled: boolean;
  onSave?: () => void;
  onDiscard: () => void;
  label: string;
}) {
  return (
    <div className="save-bar" role="region" aria-label={label}>
      <span className="save-bar__text" role="status">
        {saving
          ? "Saving…"
          : changes === 1
            ? "1 unsaved change"
            : `${changes} unsaved changes`}
      </span>
      <button
        className="btn btn--primary"
        type={onSave ? "button" : "submit"}
        disabled={saving || disabled}
        onClick={onSave}
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
      <button
        className="btn btn--quiet"
        type="button"
        disabled={saving}
        onClick={onDiscard}
      >
        Discard changes
      </button>
    </div>
  );
}

/** How many settings in a draft differ from the saved value, counting nested fields one by one. */
export function countChanges(draft: unknown, saved: unknown): number {
  const plain = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  if (plain(draft) && plain(saved)) {
    let count = 0;
    for (const key of new Set([...Object.keys(draft), ...Object.keys(saved)]))
      count += countChanges(draft[key], saved[key]);
    return count;
  }
  return JSON.stringify(draft ?? null) === JSON.stringify(saved ?? null)
    ? 0
    : 1;
}
