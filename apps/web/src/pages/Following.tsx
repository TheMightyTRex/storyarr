import {
  CollectionViewSwitch,
  readSort,
  SortControl,
  useCollectionView,
} from "../components/GroupShelf";
import {
  FollowDetailView,
  FollowListView,
} from "../components/FollowCollection";
import { lazy, Suspense, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Search, UserRound } from "lucide-react";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Loading, Notice } from "../components";
import BookCover from "../components/BookCover";
import DetailTabs from "../components/DetailTabs";
const FollowSettings = lazy(() => import("./FollowSettings"));

type Summary = components["schemas"]["FollowSummary"];
type Book = components["schemas"]["FollowBook"];
type Status = NonNullable<Book["status"]>;
export type StatusKind = Status["kind"];
// Same chip colours as request statuses, so a state reads the same on every page.
export const statusChip: Record<StatusKind, string> = {
  in_library: "satisfied",
  downloading: "downloading",
  importing: "downloading",
  searching: "downloading",
  waiting: "waiting",
  not_released: "waiting",
  attention: "paused",
  wanted: "paused",
  excluded: "cancelled",
  not_requested: "cancelled",
};
export const statusNames: Record<StatusKind, string> = {
  in_library: "In library",
  downloading: "Downloading",
  importing: "Importing",
  searching: "Searching",
  waiting: "Waiting",
  not_released: "Not released",
  attention: "Needs attention",
  wanted: "Wanted",
  excluded: "Excluded",
  not_requested: "Not requested",
};
export const statusLinks: Partial<Record<StatusKind, string>> = {
  downloading: "/requests",
  importing: "/requests",
  attention: "/requests?status=review",
  wanted: "/requests",
};
export function when(value: string) {
  const at = new Date(value);
  const time = at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return at.toDateString() === new Date().toDateString()
    ? time
    : at.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " " +
        time;
}
function BookStatusLine({ status }: { status: Status }) {
  const chip = (
    <span className="request-status" data-state={statusChip[status.kind]}>
      {status.label}
    </span>
  );
  const href = statusLinks[status.kind];
  const detail = [status.detail, status.at ? when(status.at) : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="follow-book-status">
      {href ? (
        <Link to={href} aria-label={`${status.label}: view in Requests`}>
          {chip}
        </Link>
      ) : (
        chip
      )}
      {detail && <p className="follow-book-status-detail">{detail}</p>}
    </div>
  );
}
type BookFilter = "all" | "library" | "upcoming" | "recent" | "missing";
type Filter = "all" | "upcoming" | "recent" | "missing" | "paused";
function choice<T extends string>(
  value: string | null,
  choices: readonly T[],
  fallback: T,
): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}
export function publication(book: Book) {
  return book.release_date
    ? new Date(book.release_date + "T12:00:00Z").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : book.upcoming
      ? "Date to be announced"
      : "Publication date unknown";
}
function bookHref(book: Book) {
  return "/books/" + book.work_id;
}
function BookPreview({
  book,
  compact = false,
}: {
  book: Book;
  compact?: boolean;
}) {
  return (
    <article className={compact ? "follow-book compact" : "follow-book"}>
      <Link
        to={bookHref(book)}
        className="follow-book-cover"
        aria-label={"View " + book.title}
      >
        <BookCover title={book.title} cover={book.cover_url} actions={false} />
      </Link>
      <div className="follow-book-copy">
        <Link to={bookHref(book)} className="follow-book-title">
          {book.title}
        </Link>
        {!compact && (
          <p className="muted">
            {book.follow_names?.length
              ? book.follow_names.join(" · ")
              : book.authors.join(", ")}
          </p>
        )}
        <p className="follow-book-date">{publication(book)}</p>
        {book.status ? (
          <BookStatusLine status={book.status} />
        ) : (
          <>
            {(book.ebook || book.audio) && (
              <p className="follow-book-owned">
                <Check size={12} aria-hidden="true" /> In library
                {book.stale ? " · Last known" : ""}
              </p>
            )}
            {!book.included && <p className="muted">Excluded from updates</p>}
          </>
        )}
      </div>
    </article>
  );
}

export function FollowBooks({
  follow,
  selection,
}: {
  follow: Pick<Summary, "list_id" | "last_success_at">;
  selection: BookFilter;
}) {
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<StatusKind | null>(null);
  const query = useQuery({
    queryKey: [
      "following",
      "books",
      follow.list_id,
      follow.last_success_at,
      selection,
      status,
      offset,
    ],
    queryFn: async () =>
      result(
        await api.GET("/api/following/{list_id}/books", {
          params: {
            path: { list_id: follow.list_id },
            query: {
              filter: selection,
              offset,
              limit: 12,
              ...(status ? { status } : {}),
            },
          },
        }),
      ),
  });
  const counts = query.data?.status_counts;
  const pick = (value: StatusKind | null) => {
    setStatus(value);
    setOffset(0);
  };
  return (
    <div className="follow-expanded">
      <Notice error={query.error} />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <button onClick={() => query.refetch()}>Retry books</button>
      ) : (
        <>
          {counts && (
            <div
              className="follow-status-filters"
              role="group"
              aria-label="Show books by status"
            >
              <button
                type="button"
                aria-pressed={status === null}
                onClick={() => pick(null)}
              >
                All {Object.values(counts).reduce((a, b) => a + b, 0)}
              </button>
              {(Object.keys(statusNames) as StatusKind[])
                .filter((kind) => counts[kind])
                .map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    aria-pressed={status === kind}
                    onClick={() => pick(status === kind ? null : kind)}
                  >
                    <span
                      className="request-status"
                      data-state={statusChip[kind]}
                    >
                      {statusNames[kind]}
                    </span>{" "}
                    {counts[kind]}
                  </button>
                ))}
            </div>
          )}
          {!query.data?.items.length && (
            <p className="muted">No books match this view.</p>
          )}
          <div className="follow-books-grid">
            {query.data?.items.map((book) => (
              <BookPreview key={book.work_id} book={book} />
            ))}
          </div>
          {!!query.data?.total && (
            <div className="follow-pagination">
              <button
                disabled={!offset || query.isFetching}
                onClick={() => setOffset(Math.max(0, offset - 12))}
              >
                Previous books
              </button>
              <span>
                {offset + 1}–{Math.min(offset + 12, query.data.total)} of{" "}
                {query.data.total}
              </span>
              <button
                disabled={offset + 12 >= query.data.total || query.isFetching}
                onClick={() => setOffset(offset + 12)}
              >
                Next books
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FollowingReleases({
  kind,
  shelf = false,
  catalogRevision,
}: {
  kind?: "author" | "series";
  shelf?: boolean;
  catalogRevision?: string;
}) {
  const [params, setParams] = useSearchParams();
  const selection = shelf
    ? "upcoming"
    : choice(
        params.get("releases"),
        ["upcoming", "recent"] as const,
        "upcoming",
      );
  const query = useInfiniteQuery({
    queryKey: [
      "following",
      "releases",
      kind,
      selection,
      shelf,
      catalogRevision,
    ],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      result(
        await api.GET("/api/following/releases", {
          params: {
            query: {
              kind,
              filter: selection,
              offset: pageParam,
              limit: shelf ? 3 : 24,
            },
          },
        }),
      ),
    getNextPageParam: (last) =>
      last.offset + last.limit < last.total
        ? last.offset + last.limit
        : undefined,
    staleTime: 30_000,
  });
  const books = query.data?.pages.flatMap((page) => page.items) || [];
  const months = new Map<string, Book[]>();
  if (!shelf)
    for (const book of books) {
      const month = book.release_date?.slice(0, 7) || "undated";
      months.set(month, [...(months.get(month) || []), book]);
    }
  if (shelf && !books.length && !query.error) return null;
  return (
    <section
      className={"follow-releases " + (shelf ? "follow-release-shelf" : "")}
      aria-label={shelf ? "Coming up" : "Followed releases"}
    >
      <div className="follow-section-heading">
        <h2>
          {shelf
            ? "Coming up from your " +
              (kind === "series" ? "series" : "authors")
            : "Releases from your follows"}
        </h2>
        {shelf ? (
          <Link to="?tab=releases">
            View all releases <ArrowRight size={14} aria-hidden="true" />
          </Link>
        ) : (
          <label>
            Show{" "}
            <select
              value={selection}
              onChange={(event) => {
                const next = new URLSearchParams(params);
                next.set("releases", event.target.value);
                setParams(next);
              }}
            >
              <option value="upcoming">Upcoming</option>
              <option value="recent">Published in the last 90 days</option>
            </select>
          </label>
        )}
      </div>
      <Notice error={query.error} />
      {query.error && (
        <button onClick={() => query.refetch()}>Retry releases</button>
      )}
      {query.isPending && !shelf ? (
        <Loading />
      ) : (
        <>
          {shelf ? (
            <div className="follow-release-grid">
              {books.map((book) => (
                <BookPreview key={book.work_id} book={book} />
              ))}
            </div>
          ) : (
            [...months].map(([month, entries]) => (
              <section className="follow-release-month" key={month}>
                <h3>
                  {month === "undated"
                    ? "Announced · Date to be confirmed"
                    : new Date(month + "-01T12:00:00Z").toLocaleDateString(
                        undefined,
                        { month: "long", year: "numeric", timeZone: "UTC" },
                      )}
                </h3>
                <div className="follow-release-grid">
                  {entries.map((book) => (
                    <BookPreview key={book.work_id} book={book} />
                  ))}
                </div>
              </section>
            ))
          )}
          {!shelf && !books.length && !query.error && (
            <p className="follow-empty">
              No{" "}
              {selection === "upcoming"
                ? "announced releases"
                : "recent publications"}{" "}
              from your follows. New catalog updates will appear here.
            </p>
          )}
          {!shelf && query.hasNextPage && (
            <button
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more releases"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Overview() {
  const [params, setParams] = useSearchParams();
  const tab = choice(
    params.get("tab"),
    ["authors", "series", "releases"] as const,
    "authors",
  );
  const kind = tab === "series" ? "series" : "author";
  const q = params.get("q") || "";
  const filter = choice(
    params.get("filter"),
    ["all", "upcoming", "recent", "missing", "paused"] as const,
    "all",
  ) as Filter;
  const { sort, reverse } = readSort(params, "new");
  const query = useInfiniteQuery({
    queryKey: ["following", "overview", kind, q, filter, sort, reverse],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      result(
        await api.GET("/api/following/overview", {
          params: {
            query: {
              kind,
              q,
              filter,
              sort,
              reverse,
              offset: pageParam,
              limit: 20,
            },
          },
        }),
      ),
    getNextPageParam: (last) =>
      last.offset + last.limit < last.total
        ? last.offset + last.limit
        : undefined,
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.pages[0]?.pending_sync ? 5000 : false,
  });
  const page = query.data?.pages[0];
  const follows = query.data?.pages.flatMap((page) => page.items) || [];
  const layout = useCollectionView();
  const loadMore = query.hasNextPage && (
    <div className="follow-load-more">
      <button
        disabled={query.isFetchingNextPage}
        onClick={() => query.fetchNextPage()}
      >
        {query.isFetchingNextPage ? "Loading…" : "Load more " + tab}
      </button>
    </div>
  );
  const set = (key: string, value: string) => {
    // The address as it is now, so a quick change keeps an earlier one.
    const next = new URLSearchParams(window.location.search);
    value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  };
  const tabs = [
    ["authors", "Authors" + (page ? " · " + page.authors : "")],
    ["series", "Series" + (page ? " · " + page.series : "")],
    ["releases", "Releases"],
  ] as const;
  return (
    <section className="reader-page following-page">
      <header className="following-heading">
        <div>
          <p className="eyebrow">YOUR READING WORLD</p>
          <h1>Following</h1>
          <p>Keep up with the authors and series you enjoy.</p>
        </div>
        <Link to="/search" className="reader-action-link">
          <Search size={14} aria-hidden="true" /> Find authors
        </Link>
      </header>
      <DetailTabs tabs={tabs} selected={tab} label="Following sections" />
      <div
        id="detail-tab-panel"
        role="tabpanel"
        aria-labelledby={"detail-tab-" + tab}
      >
        {tab === "releases" ? (
          <FollowingReleases catalogRevision={page?.catalog_revision} />
        ) : (
          <>
            <FollowingReleases
              catalogRevision={page?.catalog_revision}
              kind={kind}
              shelf
            />
            <div className="follow-section-heading">
              <h2>Your {tab}</h2>
              {page && (
                <span className="muted" role="status">
                  {page.total}{" "}
                  {page.total === 1 && tab === "authors" ? "author" : tab}
                </span>
              )}
            </div>
            <div className="follow-toolbar">
              <form
                key={q}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  set("q", String(form.get("q") || "").trim());
                }}
              >
                <label htmlFor="follow-search">Search followed {tab}</label>
                <div className="follow-search-field">
                  <input
                    id="follow-search"
                    name="q"
                    type="search"
                    maxLength={200}
                    defaultValue={q}
                    placeholder="Search by name"
                  />
                  <button type="submit" aria-label="Search follows">
                    <Search size={16} aria-hidden="true" />
                  </button>
                </div>
              </form>
              <label>
                Show
                <select
                  value={filter}
                  onChange={(event) => set("filter", event.target.value)}
                >
                  <option value="all">All {tab}</option>
                  <option value="upcoming">Upcoming releases</option>
                  <option value="recent">Published recently</option>
                  <option value="missing">Books not in library</option>
                  <option value="paused">Updates paused</option>
                </select>
              </label>
              <SortControl sort={sort} reverse={reverse} onChange={set} />
              <CollectionViewSwitch
                view={layout.view}
                onChange={layout.setView}
              />
            </div>
            <Notice error={query.error} />
            {query.error && (
              <button onClick={() => query.refetch()}>Retry following</button>
            )}
            {query.isPending ? (
              <Loading />
            ) : (
              <>
                {!follows.length && !query.error && (
                  <div className="follow-empty">
                    <UserRound size={32} aria-hidden="true" />
                    <h2>
                      {q || filter !== "all"
                        ? "No matching follows"
                        : "Your next great read starts with an author"}
                    </h2>
                    <p>
                      {q || filter !== "all"
                        ? "Try another name or clear your filters."
                        : "Open an author or series page and choose Follow to get started."}
                    </p>
                    {q || filter !== "all" ? (
                      <button onClick={() => setParams({ tab })}>
                        Clear filters
                      </button>
                    ) : (
                      <Link to="/search" className="reader-action-link">
                        Find a book or author
                      </Link>
                    )}
                    <p className="muted">
                      Following keeps you up to date. Downloads are configured
                      separately.
                    </p>
                  </div>
                )}
                {follows.length > 0 &&
                  (layout.view === "detail" ? (
                    <FollowDetailView
                      follows={follows}
                      label={
                        tab === "authors"
                          ? "Followed authors"
                          : "Followed series"
                      }
                      selected={params.get("pick") || undefined}
                      onSelect={(listId) => set("pick", listId)}
                      more={loadMore}
                    />
                  ) : (
                    <>
                      <FollowListView
                        follows={follows}
                        label={
                          tab === "authors"
                            ? "Followed authors"
                            : "Followed series"
                        }
                      />
                      {loadMore}
                    </>
                  ))}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default function Following() {
  const [params] = useSearchParams();
  return params.has("list") ||
    (params.has("kind") && params.has("externalId")) ? (
    <Suspense fallback={<Loading />}>
      <FollowSettings />
    </Suspense>
  ) : (
    <Overview />
  );
}
