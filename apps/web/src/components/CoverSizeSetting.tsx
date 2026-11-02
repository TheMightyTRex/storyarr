import { useState } from "react";
import { Notice } from "../components";
import { usePreferences } from "../hooks/usePreferences";
import "../library-shelf.css";

export type CoverSize = "small" | "medium" | "large";
const sizes: { id: CoverSize; label: string; hint: string }[] = [
  { id: "small", label: "Small", hint: "More books on screen" },
  { id: "medium", label: "Medium", hint: "The standard size" },
  { id: "large", label: "Large", hint: "Easier to read covers" },
];

/** Settings, General: how big covers are on My library. Saved with the account. */
export default function CoverSizeSetting() {
  const { preferences, save } = usePreferences();
  // The choice shows at once; the saved preference follows (and wins if saving fails).
  const [chosen, setChosen] = useState<CoverSize>();
  const current =
    (save.isError ? undefined : chosen) ?? preferences?.cover_size ?? "medium";
  return (
    <fieldset className="cover-size-setting">
      <legend>Cover size on My library</legend>
      <p className="muted">
        Saved with your account, so it follows you to every browser.
      </p>
      <div className="cover-size-options">
        {sizes.map((size) => (
          <label key={size.id} data-size={size.id}>
            <input
              type="radio"
              name="cover-size"
              checked={current === size.id}
              onChange={() => {
                setChosen(size.id);
                save.mutate({ cover_size: size.id });
              }}
            />
            <span className="cover-size-swatch" aria-hidden="true" />
            <span>
              <strong>{size.label}</strong>
              <small>{size.hint}</small>
            </span>
          </label>
        ))}
      </div>
      <Notice error={save.error} />
    </fieldset>
  );
}
