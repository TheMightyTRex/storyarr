import { useEffect, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";

function time(value: Date) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

/**
 * The shared library's saved note (option D): on settings pages, "Saved at 16:31" beside the button that
 * saved, instead of a toast. It goes at the next change in the same form or settings section. The status
 * region stays in the page while empty, so assistive technology reads the note when it appears.
 */
export default function SavedNote({
  at,
  detail,
}: {
  at: Date | null | undefined;
  /** A sentence after the time, such as "It applies within a minute." */
  detail?: string;
}) {
  const note = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<Date | null>(null);
  useEffect(() => {
    setShown(at ?? null);
    const scope =
      note.current?.closest("form, .settings-section, .settings-block") ??
      document;
    const hide = () => setShown(null);
    if (!at) return;
    scope.addEventListener("input", hide);
    scope.addEventListener("change", hide);
    return () => {
      scope.removeEventListener("input", hide);
      scope.removeEventListener("change", hide);
    };
  }, [at]);
  return (
    <span ref={note} className="saved-note" role="status" hidden={!shown}>
      {shown && (
        <>
          <CircleCheck
            className="i"
            size={20}
            aria-hidden="true"
            focusable="false"
          />
          <span>
            Saved at {time(shown)}
            {detail ? `. ${detail}` : ""}
          </span>
        </>
      )}
    </span>
  );
}
