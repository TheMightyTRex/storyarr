import { useState } from "react";
import { useDisplayPreferences } from "../displayPreferences";

/**
 * Send feedback: Snaglist's window for a bug, a UX problem or a suggestion, sent as a GitHub issue on
 * Storyarr's repository. Snaglist loads only when someone selects this, so it costs nothing until then,
 * and it records nothing personal: names on screen are marked data-snag-private.
 */
export function SendFeedback({ version }: { version?: string }) {
  const [failed, setFailed] = useState(false);
  const { theme } = useDisplayPreferences();
  async function open() {
    try {
      await import("../vendor/snaglist.js");
      const snaglist = window.Snaglist;
      if (!snaglist) throw new Error("Snaglist did not load");
      snaglist.start({
        app: "Storyarr",
        language: "en-GB",
        version: version || "",
        theme,
        launcher: false,
        send: { github: { repo: "TheMightyTRex/storyarr" } },
      });
      snaglist.open();
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  return (
    <>
      <button
        type="button"
        className="send-feedback text-button"
        aria-haspopup="dialog"
        onClick={open}
      >
        Send feedback
      </button>
      {failed && (
        <small role="status">
          Send feedback could not open. Reload the page and try again.
        </small>
      )}
    </>
  );
}
