import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, X } from "lucide-react";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Loading, Notice } from "../components";
import BookCover from "../components/BookCover";
import AddMissingBooks from "../components/AddMissingBooks";
import QuickAdd from "../components/QuickAdd";
import {
  publication,
  statusChip,
  statusLinks,
  statusNames,
  when,
} from "./Following";
import type { StatusKind } from "./Following";

type Book = components["schemas"]["FollowBook"];
type Auth = components["schemas"]["AuthView"];
// Books that are not on their way yet, so a search can start now.
const SEARCHABLE = new Set<StatusKind>([
  "not_requested",
  "wanted",
  "attention",
]);
const PAGE = 48;

// One followed series or author as a bookshelf: progress, status chips, a cover wall and a book drawer.
export default function FollowShelf() {
  const { listId = "" } = useParams();
  const [status, setStatus] = useState<StatusKind | null>(null);
  const [open, setOpen] = useState<Book | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const summary = useQuery({
    queryKey: ["following", "summary", listId],
    queryFn: async () =>
      result(
        await api.GET("/api/following/{list_id}/summary", {
          params: { path: { list_id: listId } },
        }),
      ),
  });
  const totals = useQuery({
    queryKey: [
      "following",
      "shelf-counts",
      listId,
      summary.data?.last_success_at,
    ],
    enabled: !!summary.data,
    queryFn: async () =>
      result(
        await api.GET("/api/following/{list_id}/books", {
          params: { path: { list_id: listId }, query: { limit: 1 } },
        }),
      ),
  });
  const books = useInfiniteQuery({
    queryKey: [
      "following",
      "shelf",
      listId,
      summary.data?.last_success_at,
      status,
    ],
    enabled: !!summary.data,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      result(
        await api.GET("/api/following/{list_id}/books", {
          params: {
            path: { list_id: listId },
            query: {
              offset: pageParam,
              limit: PAGE,
              ...(status ? { status } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) =>
      last.offset + last.limit < last.total
        ? last.offset + last.limit
        : undefined,
  });
  function close() {
    setOpen(null);
    opener.current?.focus();
  }
  if (summary.isPending) return <Loading />;
  if (summary.error || !summary.data)
    return (
      <div className="follow-shelf">
        <Notice error={summary.error} />
        <Link to="/following">Back to Following</Link>
      </div>
    );
  const follow = summary.data;
  const counts = totals.data?.status_counts;
  const all = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  const owned = counts?.in_library ?? 0;
  const excluded = counts?.excluded ?? 0;
  const unreleased = counts?.not_released ?? 0;
  const wanted = Math.max(all - excluded - unreleased, 0);
  const items = books.data?.pages.flatMap((page) => page.items) ?? [];
  const cover =
    (follow.image_url &&
      "/api/catalog/cover-image?url=" + encodeURIComponent(follow.image_url)) ||
    items[0]?.cover_url;
  return (
    <div className={open ? "follow-shelf has-drawer" : "follow-shelf"}>
      <div className="follow-shelf-main">
        <Link to="/following" className="follow-shelf-back">
          <ArrowLeft size={15} aria-hidden="true" /> Following
        </Link>
        <section className="wall-header" aria-labelledby="wall-title">
          <div className="wall-header-art" aria-hidden="true">
            {cover ? (
              <img src={cover} alt="" />
            ) : (
              <span>{follow.name.slice(0, 1)}</span>
            )}
          </div>
          <div className="wall-header-copy">
            <p className="wall-eyebrow">
              {follow.source_kind === "author" ? "Author" : "Series"}
            </p>
            <h1 id="wall-title">{follow.name}</h1>
            {counts && (
              <div className="wall-progress">
                <progress
                  value={owned}
                  max={wanted || 1}
                  aria-label={`${owned} of ${wanted} released books in your library`}
                />
                <p>
                  <strong>
                    {owned} of {wanted}
                  </strong>{" "}
                  released books in your library
                  {excluded ? ` · ${excluded} excluded` : ""}
                  {unreleased ? ` · ${unreleased} not released yet` : ""}
                </p>
              </div>
            )}
            <div className="wall-actions">
              <AddMissingBooks
                kind={follow.source_kind}
                externalId={follow.external_id}
                name={follow.name}
              />
              <Link
                className="reader-action-link"
                to={"/following?list=" + follow.list_id}
              >
                Manage follow
              </Link>
              <Link
                className="reader-action-link"
                to={
                  (follow.source_kind === "author"
                    ? "/authors/hardcover/"
                    : "/series/hardcover/") + follow.external_id
                }
              >
                {follow.source_kind === "author"
                  ? "Author page"
                  : "Series page"}
              </Link>
            </div>
          </div>
        </section>
        {counts && (
          <div
            className="follow-status-filters wall-filters"
            role="group"
            aria-label="Show books by status"
          >
            <button
              type="button"
              aria-pressed={status === null}
              onClick={() => setStatus(null)}
            >
              All {all}
            </button>
            {(Object.keys(statusNames) as StatusKind[])
              .filter((kind) => counts[kind])
              .map((kind) => (
                <button
                  type="button"
                  key={kind}
                  aria-pressed={status === kind}
                  onClick={() => setStatus(status === kind ? null : kind)}
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
        <Notice error={books.error} />
        {books.isPending ? (
          <Loading />
        ) : !items.length ? (
          <p className="muted">
            No books have this status. Choose All to see every book.
          </p>
        ) : (
          <ul className="cover-wall" aria-label={follow.name + " books"}>
            {items.map((book) => {
              const kind = book.status?.kind;
              return (
                <li
                  key={book.work_id}
                  className={kind === "excluded" ? "is-excluded" : undefined}
                >
                  <button
                    type="button"
                    className="cover-wall-book"
                    aria-pressed={open?.work_id === book.work_id}
                    aria-label={`${book.title}${book.status ? ", " + book.status.label : ""}`}
                    onClick={(event) => {
                      opener.current = event.currentTarget;
                      setOpen(book);
                    }}
                  >
                    <BookCover
                      title={book.title}
                      cover={book.cover_url}
                      actions={false}
                    />
                    {book.status && kind && (
                      <span
                        className="request-status cover-wall-chip"
                        data-state={statusChip[kind]}
                        aria-hidden="true"
                      >
                        {book.status.label}
                      </span>
                    )}
                    <span className="cover-wall-title" aria-hidden="true">
                      {book.title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {books.hasNextPage && (
          <button
            type="button"
            className="wall-more"
            disabled={books.isFetchingNextPage}
            onClick={() => books.fetchNextPage()}
          >
            {books.isFetchingNextPage
              ? "Loading more books…"
              : "Show more books"}
          </button>
        )}
      </div>
      {open && (
        <BookDrawer
          book={open}
          listId={listId}
          close={close}
          changed={(next) => setOpen(next)}
        />
      )}
    </div>
  );
}

function BookDrawer({
  book,
  listId,
  close,
  changed,
}: {
  book: Book;
  listId: string;
  close: () => void;
  changed: (book: Book) => void;
}) {
  const cache = useQueryClient();
  const { data: session } = useQuery<Auth | null>({
    queryKey: ["session"],
    enabled: false,
  });
  const canEdit = !!session && session.user.role !== "viewer";
  const excluded = book.status?.kind === "excluded";
  const exclude = useMutation({
    mutationFn: async () =>
      result(
        await api.PATCH(
          "/api/lists/{list_id}/subscription/observations/{observation_id}",
          {
            params: {
              path: { list_id: listId, observation_id: book.observation_id! },
            },
            body: { excluded: !excluded },
          },
        ),
      ),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["following"] });
      changed({
        ...book,
        status: excluded
          ? null
          : {
              ...(book.status ?? { detail: null, at: null }),
              kind: "excluded",
              label: "Excluded",
              detail: "You excluded this book.",
            },
      } as Book);
    },
  });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [book.work_id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  const status = book.status;
  const href = status ? statusLinks[status.kind] : undefined;
  const detail = status
    ? [status.detail, status.at ? when(status.at) : null]
        .filter(Boolean)
        .join(" ")
    : "";
  return (
    <aside className="book-drawer" aria-labelledby="book-drawer-title">
      <div className="book-drawer-top">
        <p className="wall-eyebrow">Book</p>
        <button
          type="button"
          className="icon-button"
          aria-label="Close book details"
          onClick={close}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="book-drawer-cover">
        <BookCover title={book.title} cover={book.cover_url} actions={false} />
      </div>
      <h2 id="book-drawer-title" ref={heading} tabIndex={-1}>
        {book.title}
      </h2>
      <p className="muted">
        {book.follow_names?.length
          ? book.follow_names.join(" · ")
          : book.authors.join(", ")}
      </p>
      <p className="muted">{publication(book)}</p>
      {status && (
        <div className="book-drawer-status">
          <span className="request-status" data-state={statusChip[status.kind]}>
            {status.label}
          </span>
          {detail && <p>{detail}</p>}
        </div>
      )}
      <div className="book-drawer-actions">
        <Link className="drawer-action primary" to={"/books/" + book.work_id}>
          Open book page
        </Link>
        {href && (
          <Link className="drawer-action" to={href}>
            Open in Activity
          </Link>
        )}
        {canEdit && status && SEARCHABLE.has(status.kind) && (
          <QuickAdd workId={book.work_id} actionLabel="Search now" />
        )}
        {canEdit && book.observation_id && (
          <button
            type="button"
            className="drawer-action"
            disabled={exclude.isPending}
            onClick={() => exclude.mutate()}
          >
            {excluded ? "Include in this follow" : "Exclude from this follow"}
          </button>
        )}
      </div>
      <Notice error={exclude.error} />
    </aside>
  );
}
