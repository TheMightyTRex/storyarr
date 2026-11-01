import { useState } from "react";
import { Notice } from "../components";
import { usePreferences } from "../hooks/usePreferences";
import { sectionNames, type LibrarySection } from "../hooks/useSavedView";

/** Settings, General: the Library views saved as defaults, and a way back to the standard views. */
export default function SavedViewsSettings() {
  const { preferences, save } = usePreferences();
  const [done, setDone] = useState(false);
  const saved = Object.keys(
    preferences?.library_views || {},
  ) as LibrarySection[];
  return (
    <div className="saved-views-settings">
      <h3>Saved views</h3>
      <p className="muted">
        Use Save as default on a Library tab to open it with your own filters
        and order. Saved views follow your account to every browser.
      </p>
      {saved.length ? (
        <ul>
          {saved.map((section) => (
            <li key={section}>{sectionNames[section]}</li>
          ))}
        </ul>
      ) : (
        <p>No saved views. Every Library tab opens with the standard view.</p>
      )}
      <Notice error={save.error} />
      <button
        type="button"
        disabled={!saved.length || save.isPending}
        onClick={() =>
          save.mutate({ library_views: {} }, { onSuccess: () => setDone(true) })
        }
      >
        {save.isPending ? "Resetting…" : "Reset to default"}
      </button>
      <p role="status">
        {done && !saved.length ? "Library views reset to default." : ""}
      </p>
    </div>
  );
}
