import { useEffect, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";

// Quick answers finish before this, so the bar only appears when a page is really waiting.
const DELAY = 250;

/** A thin bar under the header while any page data is loading. */
export default function LoadingBar() {
  const fetching = useIsFetching() > 0;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!fetching) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), DELAY);
    return () => clearTimeout(timer);
  }, [fetching]);
  return (
    <div className="loading-bar" data-active={shown || undefined}>
      {shown && (
        <span className="sr-only" role="status">
          Loading
        </span>
      )}
    </div>
  );
}
