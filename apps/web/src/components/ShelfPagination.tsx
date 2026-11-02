import { useEffect, useRef } from "react";
export default function ShelfPagination({
  hasMore,
  busy,
  label,
  infinite,
}: {
  page: number;
  hasMore: boolean;
  busy: boolean;
  onPage: (page: number) => void;
  label: string;
  max?: number;
  infinite?: {
    fetchNextPage: () => Promise<unknown>;
    isFetchNextPageError: boolean;
    count: number;
  };
}) {
  const nav = useRef<HTMLElement>(null);
  function shelf() {
    return nav.current
      ?.closest(".discovery-section")
      ?.querySelector<HTMLElement>(".discovery-shelf");
  }
  useEffect(() => {
    const element = shelf();
    const last = element?.lastElementChild;
    if (
      !infinite ||
      !element ||
      !last ||
      !hasMore ||
      busy ||
      infinite.isFetchNextPageError
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          void infinite.fetchNextPage();
        }
      },
      { root: element, rootMargin: "0px 160px 0px 0px" },
    );
    observer.observe(last);
    return () => observer.disconnect();
  }, [
    infinite?.count,
    infinite?.fetchNextPage,
    infinite?.isFetchNextPageError,
    hasMore,
    busy,
  ]);
  // The arrows are on the shelf itself (ShelfScroller); here: loading more as the shelf scrolls to
  // its end, what is loading, and a retry when loading more failed.
  return (
    <nav
      ref={nav}
      className="shelf-pagination"
      aria-label={`${label} navigation`}
    >
      {busy && <span role="status">Loading…</span>}
      {infinite?.isFetchNextPageError && (
        <button type="button" onClick={() => void infinite.fetchNextPage()}>
          Retry loading {label}
        </button>
      )}
    </nav>
  );
}
