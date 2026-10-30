import { useEffect, useId, useRef, useState } from "react";
import { Contrast } from "lucide-react";
import {
  accessibilityKeys,
  displayDefaults,
  saveDisplayPreferences,
  useDisplayPreferences,
} from "../displayPreferences";
import type { DisplayPreferences } from "../displayPreferences";

const themes: { id: DisplayPreferences["theme"]; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "auto", label: "Match device" },
];
const sizes: DisplayPreferences["textSize"][] = [100, 125, 150, 175];
const switches: {
  id:
    | "readableFont"
    | "highContrast"
    | "reduceMotion"
    | "underlineLinks"
    | "wideSpacing";
  label: string;
  hint: string;
}[] = [
  {
    id: "readableFont",
    label: "Low-vision font",
    hint: "Uses Atkinson Hyperlegible Next, a typeface designed for readers with low vision.",
  },
  {
    id: "highContrast",
    label: "High contrast",
    hint: "Makes text, icons, and borders stronger against the background.",
  },
  {
    id: "reduceMotion",
    label: "Reduce motion",
    hint: "Stops animations and moving effects. This is always active when your device is set to reduce motion.",
  },
  {
    id: "underlineLinks",
    label: "Underline links",
    hint: "Underlines links in page text so they do not rely on colour.",
  },
  {
    id: "wideSpacing",
    label: "Wider text spacing",
    hint: "Adds space between letters, words, and lines.",
  },
];

// Theme, text size and reading aids. Used in Settings, onboarding and the Display dialog.
export default function DisplayPanel({
  headingLevel = 3,
}: {
  headingLevel?: 2 | 3;
}) {
  const display = useDisplayPreferences();
  const [message, setMessage] = useState("");
  const id = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  function update(change: Partial<DisplayPreferences>, note: string) {
    try {
      saveDisplayPreferences({ ...display, ...change });
      setMessage(note);
    } catch {
      setMessage(
        "Your browser could not save this setting. Allow this site to store data and try again.",
      );
    }
  }
  function reset() {
    const defaults: Partial<DisplayPreferences> = {};
    for (const name of accessibilityKeys)
      Object.assign(defaults, { [name]: displayDefaults[name] });
    update(defaults, "Display settings reset.");
  }
  return (
    <section className="display-panel" aria-labelledby={id}>
      <Heading id={id}>Display and accessibility</Heading>
      <p className="muted">
        These settings apply to this browser only, and you can change them at
        any time.
      </p>
      <fieldset className="display-group">
        <legend>Theme</legend>
        <div className="segmented">
          {themes.map((theme) => (
            <label key={theme.id}>
              <input
                type="radio"
                name={`${id}-theme`}
                checked={display.theme === theme.id}
                onChange={() =>
                  update(
                    { theme: theme.id },
                    `Theme changed to ${theme.label}.`,
                  )
                }
              />
              <span>{theme.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="display-group">
        <legend>Text size</legend>
        <div className="segmented">
          {sizes.map((size) => (
            <label key={size}>
              <input
                type="radio"
                name={`${id}-text-size`}
                checked={display.textSize === size}
                onChange={() =>
                  update({ textSize: size }, `Text size changed to ${size}%.`)
                }
              />
              <span>{size}%</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="display-switches">
        {switches.map((item) => (
          <label key={item.id} className="display-switch">
            <span className="display-switch-text">
              <strong>{item.label}</strong>
              <span className="muted">{item.hint}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={display[item.id]}
              onChange={(event) =>
                update(
                  { [item.id]: event.target.checked },
                  `${item.label} ${event.target.checked ? "activated" : "deactivated"}.`,
                )
              }
            />
          </label>
        ))}
      </div>
      <button type="button" onClick={reset}>
        Reset display settings
      </button>
      <p role="status" className="display-status">
        {message}
      </p>
    </section>
  );
}

export function DisplayButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <>
      <button
        type="button"
        className="topbar-action display-button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Contrast size={18} aria-hidden="true" />
        <span className="topbar-label">Display</span>
      </button>
      <dialog
        ref={dialog}
        className="display-dialog"
        aria-label="Display and accessibility"
        onClose={() => setOpen(false)}
      >
        {open && <DisplayPanel headingLevel={2} />}
        <div className="display-dialog-actions">
          <button
            type="button"
            className="primary"
            onClick={() => setOpen(false)}
          >
            Done
          </button>
        </div>
      </dialog>
    </>
  );
}
