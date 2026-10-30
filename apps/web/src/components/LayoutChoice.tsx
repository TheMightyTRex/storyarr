import { useState } from "react";
import { Check } from "lucide-react";
import {
  saveDisplayPreferences,
  useDisplayPreferences,
} from "../displayPreferences";
import type { DisplayPreferences } from "../displayPreferences";

const layouts: {
  id: DisplayPreferences["layout"];
  title: string;
  summary: string;
}[] = [
  {
    id: "classic",
    title: "Classic",
    summary:
      "The original menu with every page listed by name. Your current pages stay where they are.",
  },
  {
    id: "shelf",
    title: "Shelf",
    summary:
      "A slim icon menu with four places: Library, Discover, Activity, and Settings. Each section shows its own menu in a bar under the search box.",
  },
];

export default function LayoutChoice() {
  const display = useDisplayPreferences();
  const [message, setMessage] = useState("");
  function choose(layout: DisplayPreferences["layout"]) {
    try {
      saveDisplayPreferences({ ...display, layout });
      setMessage(
        `Layout changed to ${layout === "shelf" ? "Shelf" : "Classic"}.`,
      );
    } catch {
      setMessage(
        "Your browser could not save the layout. Allow this site to store data and try again.",
      );
    }
  }
  return (
    <fieldset className="layout-choice">
      <legend>Layout</legend>
      <p className="muted">
        Choose how menus and pages are arranged. This applies to this browser
        only, and you can change it at any time.
      </p>
      <div className="layout-options">
        {layouts.map((layout) => (
          <label
            key={layout.id}
            className={`layout-option ${display.layout === layout.id ? "is-selected" : ""}`}
          >
            <input
              type="radio"
              name="layout"
              checked={display.layout === layout.id}
              onChange={() => choose(layout.id)}
            />
            <span
              className={`layout-preview layout-preview-${layout.id}`}
              aria-hidden="true"
            >
              <span />
              <span />
              <span />
            </span>
            <span className="layout-text">
              <strong>
                {layout.title}
                {display.layout === layout.id && (
                  <Check size={14} aria-hidden="true" />
                )}
              </strong>
              <span className="muted">{layout.summary}</span>
            </span>
          </label>
        ))}
      </div>
      <p role="status">{message}</p>
    </fieldset>
  );
}
