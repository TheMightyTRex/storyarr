import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { components } from "../api/schema";
import { usePreferences } from "./usePreferences";

type SavedView = components["schemas"]["SavedView"];
export type LibrarySection = "books" | "authors" | "series" | "saved";

export const sectionNames: Record<LibrarySection, string> = {
  books: "In my libraries",
  authors: "Authors",
  series: "Series",
  saved: "All saved titles",
};

// The address keys a saved view covers. Search text is not saved: it is a one-off question.
function fromParams(params: URLSearchParams): SavedView {
  const medium = params.get("medium");
  return {
    medium: medium === "ebook" || medium === "audio" ? medium : null,
    library: params.get("library") || null,
    sort: params.get("sort") || null,
    reverse: params.get("reverse") === "1" || null,
  };
}

function same(a: SavedView, b?: SavedView | null) {
  return (
    (a.medium ?? null) === (b?.medium ?? null) &&
    (a.library ?? null) === (b?.library ?? null) &&
    (a.sort ?? null) === (b?.sort ?? null) &&
    !!a.reverse === !!b?.reverse
  );
}

/**
 * A Library tab's default view, saved with the person's account. Opening the tab with no filters in
 * the address applies it once; Clear all afterwards still shows everything.
 */
export function useSavedView(section: LibrarySection) {
  const { preferences, save } = usePreferences();
  const [params, setParams] = useSearchParams();
  const saved = preferences?.library_views?.[section];
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !preferences) return;
    applied.current = true;
    const keys = ["medium", "library", "sort", "reverse"];
    if (!saved || keys.some((key) => params.has(key))) return;
    const next = new URLSearchParams(params);
    if (saved.medium) next.set("medium", saved.medium);
    if (saved.library) next.set("library", saved.library);
    if (saved.sort) next.set("sort", saved.sort);
    if (saved.reverse) next.set("reverse", "1");
    setParams(next, { replace: true });
  }, [preferences, saved, params, setParams]);
  const current = fromParams(params);
  return {
    isDefault: saved ? same(current, saved) : same(current, {}),
    saving: save.isPending,
    error: save.error,
    saveDefault: () =>
      save.mutate({
        library_views: {
          ...(preferences?.library_views || {}),
          [section]: current,
        },
      }),
  };
}
