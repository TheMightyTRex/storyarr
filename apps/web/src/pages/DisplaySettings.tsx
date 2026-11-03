import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Headphones, Library, Check, Star } from "lucide-react";
import DisplayPanel from "../components/DisplayPanel";
import SavedViewsSettings from "../components/SavedViewsSettings";
import CoverSizeSetting from "../components/CoverSizeSetting";
import CoverActionsSetting from "../components/CoverActionsSetting";
import {
  displayDefaults,
  saveDisplayPreferences,
  useDisplayPreferences,
} from "../displayPreferences";
export default function DisplaySettings() {
  const navigate = useNavigate();
  const display = useDisplayPreferences();
  const [message, setMessage] = useState("");
  function update(value: typeof display) {
    try {
      saveDisplayPreferences(value);
      setMessage("Display settings saved.");
    } catch {
      setMessage(
        "Your browser could not save these settings. Allow this site to store data and try again.",
      );
    }
  }
  return (
    <div className="display-settings">
      <DisplayPanel />
      <CoverSizeSetting />
      <CoverActionsSetting />
      <h3>Appearance</h3>
      <p className="muted">
        Choose how covers look on your shelves. Changes save automatically in
        this browser.
      </p>
      <div className="display-shapes">
        {(["any", "ebook", "audio"] as const).map((format) => {
          const key =
            format === "any"
              ? "defaultShape"
              : format === "audio"
                ? "audioShape"
                : "ebookShape";
          const Icon =
            format === "audio"
              ? Headphones
              : format === "ebook"
                ? BookOpen
                : Library;
          return (
            <fieldset key={format}>
              <legend>
                <Icon size={16} aria-hidden="true" />
                {format === "any"
                  ? "Default covers"
                  : format === "audio"
                    ? "Audiobook covers"
                    : "Ebook covers"}
              </legend>
              <p className="muted">
                {format === "any"
                  ? "Mixed-format shelves"
                  : format === "audio"
                    ? "When filtering to audiobooks"
                    : "When filtering to ebooks"}
              </p>
              <div className="shape-options">
                {(["portrait", "square"] as const).map((shape) => (
                  <label
                    key={shape}
                    className={`shape-option ${display[key] === shape ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name={key}
                      checked={display[key] === shape}
                      onChange={() => update({ ...display, [key]: shape })}
                    />
                    <span className="shape-stage" aria-hidden="true">
                      <span className={`shape-swatch ${shape}`}>
                        <Icon size={20} />
                        <span />
                        <span />
                      </span>
                    </span>
                    <span className="shape-label">
                      {shape === "square" ? "Square" : "Book portrait"}
                      <Check size={13} aria-hidden="true" />
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="display-overlay-note">
        <div className="display-overlay-icons" aria-hidden="true">
          <Check size={15} />
          <BookOpen size={15} />
          <Headphones size={15} />
          <Star size={15} />
        </div>
        <p className="muted">
          Ratings appear on covers. Whether a format is in your library shows as
          a tick on its button in the cover actions.
        </p>
      </div>
      <button type="button" onClick={() => update(displayDefaults)}>
        Reset cover shapes
      </button>
      <p role="status">{message}</p>
      <SavedViewsSettings />
      <div className="display-onboarding">
        <h3>Onboarding setup wizard</h3>
        <p className="muted">
          Reopen the setup wizard to review or finish setting up your library.
          Your saved settings will be kept.
        </p>
        <button type="button" onClick={() => navigate("/onboarding")}>
          Open onboarding setup wizard
        </button>
      </div>
    </div>
  );
}
