import { useState } from "react";
import { Notice } from "../components";
import type { Work } from "../api/client";
import { usePreferences } from "../hooks/usePreferences";
import CoverCard, { type CoverActionsLayout } from "./CoverCard";

const options: { id: CoverActionsLayout; label: string; hint: string }[] = [
  {
    id: "on",
    label: "On the cover",
    hint: "The buttons run down the right edge of the cover when you point at it or tab to it, and are always there on touch screens.",
  },
  {
    id: "beside",
    label: "Beside the cover",
    hint: "The buttons sit next to the cover and are always there. Each book takes a little more room.",
  },
];

// Two made-up books for the examples: one with the ebook in the library, one with neither format.
const examples = [
  { title: "The Salt Road", author: "Mara Ellison", ebook: true },
  { title: "Half a Lantern", author: "Owen Brightwater", ebook: false },
].map(
  ({ title, author, ebook }, index) =>
    ({
      id: `example-${index}`,
      title,
      authors: [author],
      cover_url: null,
      availability: { owned: false, ebook, audio: false },
    }) as unknown as Work,
);

/**
 * Settings, Display (and the onboarding and upgrade wizards): where a cover's actions sit (UX-42).
 * Saved with the account, so it follows the person to every browser.
 */
export default function CoverActionsSetting() {
  const { preferences, save } = usePreferences();
  // The choice shows at once; the saved preference follows (and wins if saving fails).
  const [chosen, setChosen] = useState<CoverActionsLayout>();
  const current =
    (save.isError ? undefined : chosen) ?? preferences?.cover_actions ?? "on";
  return (
    <fieldset className="cover-size-setting cover-actions-setting">
      <legend>Cover actions</legend>
      <p className="muted">
        Where the buttons for a book sit: details, ebook, audiobook, add to a
        list and more. Pressing a cover always opens the book's summary. Saved
        with your account.
      </p>
      <div className="cover-actions-options">
        {options.map((option) => (
          <div
            key={option.id}
            className="cover-actions-option"
            data-checked={current === option.id || undefined}
          >
            <label>
              <input
                type="radio"
                name="cover-actions"
                checked={current === option.id}
                onChange={() => {
                  setChosen(option.id);
                  save.mutate({ cover_actions: option.id });
                }}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
              </span>
            </label>
            {/* A working example to point at; it is not in the Tab order and reads as the label above. */}
            <div
              className="cover-actions-example"
              data-layout={option.id}
              aria-hidden="true"
            >
              {examples.map((work) => (
                <CoverCard
                  key={work.id}
                  title={work.title}
                  authors={work.authors}
                  work={work}
                  to="#"
                  layout={option.id}
                  example
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <Notice error={save.error} />
    </fieldset>
  );
}
