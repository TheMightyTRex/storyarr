import { useEffect, useState, useSyncExternalStore } from "react";
import { useIsFetching } from "@tanstack/react-query";

// Quick answers finish before this, so the bar only appears when a page is really waiting.
const DELAY = 250;

// Work that runs on the server between short status checks, such as a source search.
let running = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const notify = () => listeners.forEach((listener) => listener());

/** Keep the bar under the header showing while this work is running. */
export function useLoadingBar(active: boolean) {
  useEffect(() => {
    if (!active) return;
    running += 1;
    notify();
    return () => {
      running -= 1;
      notify();
    };
  }, [active]);
}

/** A thin bar under the header while any page data is loading. */
export default function LoadingBar() {
  const working = useSyncExternalStore(subscribe, () => running > 0);
  const fetching = useIsFetching() > 0 || working;
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
