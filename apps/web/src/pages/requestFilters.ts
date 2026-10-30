export const requestFilterIds = [
  "queue",
  "downloading",
  "review",
  "pending",
  "yours",
  "history",
  "library",
  "declined",
  "withdrawn",
] as const;

export type RequestFilter = (typeof requestFilterIds)[number];
export type RequestTab = "queue" | "pending" | "history";

/** Each Activity tab and its filters. The first filter in each list shows the whole tab. */
export const tabFilters: Record<RequestTab, readonly RequestFilter[]> = {
  queue: ["queue", "downloading", "review"],
  pending: ["pending", "yours"],
  history: ["history", "library", "declined", "withdrawn"],
};

export function requestTab(filter: RequestFilter): RequestTab {
  return (Object.keys(tabFilters) as RequestTab[]).find((tab) =>
    tabFilters[tab].includes(filter),
  )!;
}

function isRequestFilter(value: string | null): value is RequestFilter {
  return requestFilterIds.some((id) => id === value);
}

/**
 * A status query selects the filter. A legacy hash applies only when that query is absent. The old
 * Active filter is now Queue; Downloading and Download review are filters inside it.
 */
export function requestFilter(
  hash: string,
  status: string | null,
): RequestFilter {
  if (isRequestFilter(status)) return status;
  if (status === "all") return "queue";
  if (hash === "#approvals") return "pending";
  if (hash === "#downloads") return "downloading";
  if (hash === "#reviews" || hash === "#review") return "review";
  return "queue";
}

type RequestPageSlice = {
  items: unknown[];
  total: number;
  next_offset?: number | null;
  total_bounded?: boolean;
};

/** Resume a bounded filter from its candidate cursor. Other filters page by visible rows. */
export function nextRequestOffset(
  page: RequestPageSlice,
  pages: { items: unknown[] }[],
  requested = 0,
) {
  if (page.total_bounded) {
    return typeof page.next_offset === "number" && page.next_offset > requested
      ? page.next_offset
      : undefined;
  }
  const count = pages.reduce((total, item) => total + item.items.length, 0);
  return page.items.length && count < page.total ? count : undefined;
}

export function requestCountLabel(
  loaded: number,
  total: number,
  bounded: boolean,
  more: boolean,
) {
  if (bounded && more) return `${loaded}+ requests`;
  const count = bounded ? loaded : total;
  return `${count} ${count === 1 ? "request" : "requests"}`;
}
