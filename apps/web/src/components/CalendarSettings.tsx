import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { components } from "../api/schema";

type Entry = components["schemas"]["ReleaseEntry"];

export type CalendarSource = "following" | "hardcover" | "librofm";

export const CALENDAR_SOURCES: { id: CalendarSource; label: string }[] = [
  { id: "following", label: "Books you follow" },
  { id: "hardcover", label: "Hardcover releases in your genres" },
  { id: "librofm", label: "Libro.fm" },
];

export type CalendarPreferences = {
  covers: boolean;
  hiddenSources: CalendarSource[];
  hiddenAuthors: string[];
};

const KEY = "storyarr:calendar:v1";
const DEFAULTS: CalendarPreferences = {
  covers: true,
  hiddenSources: [],
  hiddenAuthors: [],
};

function load(): CalendarPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!saved || typeof saved !== "object") return DEFAULTS;
    return {
      covers: saved.covers !== false,
      hiddenSources: Array.isArray(saved.hiddenSources)
        ? saved.hiddenSources
        : [],
      hiddenAuthors: Array.isArray(saved.hiddenAuthors)
        ? saved.hiddenAuthors
        : [],
    };
  } catch {
    return DEFAULTS;
  }
}

/** Calendar choices, saved in this browser like the display settings. */
export function useCalendarPreferences() {
  const [preferences, setPreferences] = useState(load);
  function update(next: CalendarPreferences) {
    setPreferences(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Private windows can refuse storage; the choice still applies until the page closes.
    }
  }
  return [preferences, update] as const;
}

export function entrySource(entry: Entry): CalendarSource {
  if (entry.followed || entry.provider === "local") return "following";
  return entry.provider === "librofm" ? "librofm" : "hardcover";
}

export function shownOnCalendar(
  entry: Entry,
  preferences: CalendarPreferences,
) {
  if (preferences.hiddenSources.includes(entrySource(entry))) return false;
  if (!entry.authors.length) return true;
  // A book shows while at least one of its authors is shown.
  return entry.authors.some(
    (author) => !preferences.hiddenAuthors.includes(author),
  );
}

export default function CalendarSettings({
  preferences,
  authors,
  onChange,
}: {
  preferences: CalendarPreferences;
  authors: string[];
  onChange: (next: CalendarPreferences) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // Hidden authors stay hidden in other months, so list them even when this month has none.
  const listed = [...new Set([...authors, ...preferences.hiddenAuthors])].sort(
    (left, right) => left.localeCompare(right),
  );
  const hidden =
    preferences.hiddenSources.length + preferences.hiddenAuthors.length;
  function toggle<T>(list: T[], value: T) {
    return list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];
  }
  return (
    <div className="genre-menu calendar-settings" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="genre-menu-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="calendar-settings-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="genre-menu-label">Show</span>
        <span className="genre-menu-value">
          {hidden ? `${hidden} hidden` : "Everything"}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          id="calendar-settings-panel"
          className="genre-menu-panel calendar-settings-panel"
        >
          <label>
            <input
              type="checkbox"
              checked={preferences.covers}
              onChange={() =>
                onChange({ ...preferences, covers: !preferences.covers })
              }
            />
            Show covers on the calendar
          </label>
          <fieldset>
            <legend>Sources</legend>
            {CALENDAR_SOURCES.map((source) => (
              <label key={source.id}>
                <input
                  type="checkbox"
                  checked={!preferences.hiddenSources.includes(source.id)}
                  onChange={() =>
                    onChange({
                      ...preferences,
                      hiddenSources: toggle(
                        preferences.hiddenSources,
                        source.id,
                      ),
                    })
                  }
                />
                {source.label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Authors</legend>
            {listed.length === 0 ? (
              <p className="muted">No authors this month.</p>
            ) : (
              <>
                <div className="button-row">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      onChange({ ...preferences, hiddenAuthors: [] })
                    }
                  >
                    Show all
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      onChange({ ...preferences, hiddenAuthors: listed })
                    }
                  >
                    Hide all
                  </button>
                </div>
                <div className="calendar-settings-authors">
                  {listed.map((author) => (
                    <label key={author}>
                      <input
                        type="checkbox"
                        checked={!preferences.hiddenAuthors.includes(author)}
                        onChange={() =>
                          onChange({
                            ...preferences,
                            hiddenAuthors: toggle(
                              preferences.hiddenAuthors,
                              author,
                            ),
                          })
                        }
                      />
                      {author}
                    </label>
                  ))}
                </div>
              </>
            )}
          </fieldset>
          <p className="muted">These choices are saved in this browser.</p>
        </div>
      )}
    </div>
  );
}
