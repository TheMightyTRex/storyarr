import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowDownUp,
  ArrowUpRight,
  Columns2,
  List,
  UserRound,
} from "lucide-react";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { BookCard, Loading, Notice } from "../components";
import BookCover from "./BookCover";
import { useReaderDetails } from "./BookReaderDetails";
import AddMissingBooks from "./AddMissingBooks";
import FollowCatalog, { useFollowing } from "./FollowCatalog";
import {
  FollowBooks,
  statusChip,
  statusNames,
  type StatusKind,
} from "../pages/Following";
import { usePreferences } from "../hooks/usePreferences";
import "../collection-views.css";

type Group = components["schemas"]["LibraryGroup"];
export type GroupKind = "authors" | "series";
export type CollectionView = "detail" | "list";
type Medium = "any" | "ebook" | "audio";

/** The saved layout for Series, Authors and Following, and a way to change it. */
export function useCollectionView() {
  const { preferences, save } = usePreferences();
  const view: CollectionView = preferences?.collection_view ?? "detail";
  return {
    view,
    setView: (next: CollectionView) => save.mutate({ collection_view: next }),
  };
}

export function CollectionViewSwitch({
  view,
  onChange,
}: {
  view: CollectionView;
  onChange: (view: CollectionView) => void;
}) {
  return (
    <div className="collection-view-switch" role="group" aria-label="Layout">
      <button
        type="button"
        aria-pressed={view === "detail"}
        onClick={() => onChange("detail")}
      >
        <Columns2 size={16} aria-hidden="true" /> List and detail
      </button>
      <button
        type="button"
        aria-pressed={view === "list"}
        onClick={() => onChange("list")}
      >
        <List size={16} aria-hidden="true" /> List
      </button>
    </div>
  );
}

export const collectionSorts = [
  ["new", "Newest"],
  ["number", "Number of books"],
  ["published", "Date published"],
  ["author", "Author"],
  ["name", "A to Z"],
] as const;
export type CollectionSort = (typeof collectionSorts)[number][0];

/** The sort and direction in the address, falling back to the page's default. */
export function readSort(params: URLSearchParams, fallback: CollectionSort) {
  const value = params.get("sort");
  const sort = collectionSorts.some(([key]) => key === value)
    ? (value as CollectionSort)
    : fallback;
  return { sort, reverse: params.get("reverse") === "1" };
}

/** Sort by, with a button that reverses the order. */
export function SortControl({
  sort,
  reverse,
  onChange,
}: {
  sort: CollectionSort;
  reverse: boolean;
  onChange: (key: "sort" | "reverse", value: string) => void;
}) {
  return (
    <>
      <label>
        Sort by
        <select
          value={sort}
          onChange={(event) => onChange("sort", event.target.value)}
        >
          {collectionSorts.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="sort-reverse"
        aria-pressed={reverse}
        onClick={() => onChange("reverse", reverse ? "" : "1")}
      >
        <ArrowDownUp size={16} aria-hidden="true" /> Reverse order
      </button>
    </>
  );
}

const normalize = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

/** Who a group is by, its picture, and the Hardcover id its follow uses. */
function useGroupIdentity(item: Group, kind: GroupKind) {
  const details = useReaderDetails(item.hardcover_book_id || undefined);
  const authors = details.data?.authors || [];
  if (kind === "authors") {
    const author = authors.find(
      (a) => normalize(a.name) === normalize(item.name),
    );
    return {
      picture: author?.image_url ?? undefined,
      byline: "",
      externalId: author?.external_id,
      followKind: "author" as const,
      sourceKind: "author",
    };
  }
  const pictured = authors.find((a) => a.image_url) || authors[0];
  return {
    picture: pictured?.image_url ?? undefined,
    byline: authors.map((a) => a.name).join(", "),
    externalId: item.external_id ?? undefined,
    followKind: "series" as const,
    sourceKind: "series",
  };
}

/** Follow state and book counts for a followed author or series; nothing when not followed. */
function useFollowProgress(sourceKind: string, externalId?: string) {
  const following = useFollowing();
  // People who cannot follow get no list; treat that as nothing followed.
  const follows = Array.isArray(following.data) ? following.data : [];
  const follow = externalId
    ? follows.find(
        (f) => f.source_kind === sourceKind && f.external_id === externalId,
      )
    : undefined;
  // Same key as the library series card, so both share one request per follow.
  const counts = useQuery({
    queryKey: [
      "following",
      "books",
      follow?.list_id,
      follow?.subscription.last_success_at,
      "counts",
    ],
    enabled: !!follow,
    queryFn: async () =>
      result(
        await api.GET("/api/following/{list_id}/books", {
          params: { path: { list_id: follow!.list_id }, query: { limit: 1 } },
        }),
      ).status_counts,
  });
  const data = counts.data ?? undefined;
  const total = data
    ? (Object.keys(data) as StatusKind[])
        .filter((kind) => kind !== "excluded")
        .reduce((sum, kind) => sum + (data[kind] ?? 0), 0)
    : null;
  return { follow, counts: data, total, inLibrary: data?.in_library ?? null };
}

function useGroup(item: Group, kind: GroupKind) {
  const identity = useGroupIdentity(item, kind);
  const progress = useFollowProgress(identity.sourceKind, identity.externalId);
  return { ...identity, ...progress };
}
type GroupState = ReturnType<typeof useGroup>;

function GroupName({
  item,
  group,
  large = false,
}: {
  item: Group;
  group: GroupState;
  large?: boolean;
}) {
  const [failed, setFailed] = useState<string>();
  const src = group.picture;
  return (
    <span className={large ? "group-name is-large" : "group-name"}>
      <span className="group-picture" aria-hidden="true">
        {src && src !== failed ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(src)}
          />
        ) : (
          <UserRound size={large ? 22 : 16} />
        )}
      </span>
      <span className="group-name-text">
        <span className="group-title">{item.name}</span>
        <span className="group-byline">{group.byline || " "}</span>
      </span>
    </span>
  );
}

function Progress({ item, group }: { item: Group; group: GroupState }) {
  const { inLibrary, total } = group;
  if (total && inLibrary !== null) {
    const percent = Math.round((inLibrary / total) * 100);
    return (
      <span className="group-progress">
        <span>
          {inLibrary} of {total}
        </span>
        <span
          className="group-bar"
          role="progressbar"
          aria-label={`${inLibrary} of ${total} books in your library`}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span
            data-complete={inLibrary >= total || undefined}
            style={{ width: `${percent}%` }}
          />
        </span>
      </span>
    );
  }
  return (
    <span className="group-progress">
      <span>{item.book_count} in your library</span>
    </span>
  );
}

function StatusChips({ group }: { group: GroupState }) {
  const counts = group.counts;
  if (!counts) return null;
  const kinds = (Object.keys(statusNames) as StatusKind[]).filter(
    (kind) => kind !== "in_library" && counts[kind],
  );
  if (!kinds.length)
    return (
      <span className="request-status" data-state="satisfied">
        Complete
      </span>
    );
  return (
    <>
      {kinds.map((kind) => (
        <span
          key={kind}
          className="request-status"
          data-state={statusChip[kind]}
        >
          {counts[kind]} {statusNames[kind].toLowerCase()}
        </span>
      ))}
    </>
  );
}

function GroupActions({
  item,
  group,
  canEdit,
}: {
  item: Group;
  group: GroupState;
  canEdit: boolean;
}) {
  if (!canEdit || !group.externalId) return null;
  return (
    <>
      <FollowCatalog
        kind={group.followKind}
        externalId={group.externalId}
        name={item.name}
      />
      <AddMissingBooks
        kind={group.followKind}
        externalId={group.externalId}
        name={item.name}
      />
    </>
  );
}

/** Layout A: one aligned row per author or series. */
export function GroupListView({
  kind,
  items,
  canEdit,
  groupLink,
}: {
  kind: GroupKind;
  items: Group[];
  canEdit: boolean;
  groupLink: (item: Group) => string;
}) {
  return (
    <div
      className="group-table"
      role="table"
      aria-label={kind === "authors" ? "Authors" : "Series"}
    >
      <div className="group-row group-head" role="row">
        <span role="columnheader">Books</span>
        <span role="columnheader">
          {kind === "authors" ? "Author" : "Series"}
        </span>
        <span role="columnheader">In your library</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" className="group-actions-head">
          Actions
        </span>
      </div>
      {items.map((item) => (
        <GroupRow
          key={item.key}
          kind={kind}
          item={item}
          canEdit={canEdit}
          to={groupLink(item)}
        />
      ))}
    </div>
  );
}

function GroupRow({
  kind,
  item,
  canEdit,
  to,
}: {
  kind: GroupKind;
  item: Group;
  canEdit: boolean;
  to: string;
}) {
  const group = useGroup(item, kind);
  return (
    <div className="group-row" role="row">
      <span className="group-covers" role="cell" aria-hidden="true">
        {item.books.slice(0, 3).map((work) => (
          <BookCover
            key={work.id}
            actions={false}
            title={work.title}
            work={work}
            medium="ebook"
          />
        ))}
      </span>
      <span role="cell" className="group-cell-name">
        <Link to={to} aria-label={`${item.name}, books in your library`}>
          <GroupName item={item} group={group} />
        </Link>
      </span>
      <span role="cell">
        <Progress item={item} group={group} />
      </span>
      <span role="cell" className="group-chips">
        <StatusChips group={group} />
      </span>
      <span role="cell" className="group-actions">
        <GroupActions item={item} group={group} canEdit={canEdit} />
      </span>
    </div>
  );
}

/** Layout D: the list beside the chosen author or series. */
export function GroupDetailView({
  kind,
  items,
  selected,
  onSelect,
  canEdit,
  medium,
  libraryId,
  more,
}: {
  kind: GroupKind;
  items: Group[];
  selected?: string;
  onSelect: (key: string) => void;
  canEdit: boolean;
  medium: Medium;
  libraryId?: string;
  more: React.ReactNode;
}) {
  const current = items.find((item) => item.key === selected) || items[0];
  return (
    <div className="group-split">
      <nav
        className="group-picker"
        aria-label={kind === "authors" ? "Authors" : "Series"}
      >
        <ul>
          {items.map((item) => (
            <li key={item.key}>
              <GroupPickerItem
                kind={kind}
                item={item}
                current={item.key === current?.key}
                onSelect={() => onSelect(item.key)}
              />
            </li>
          ))}
        </ul>
        {more}
      </nav>
      {current && (
        <GroupDetail
          key={current.key}
          kind={kind}
          item={current}
          canEdit={canEdit}
          medium={medium}
          libraryId={libraryId}
        />
      )}
    </div>
  );
}

function GroupPickerItem({
  kind,
  item,
  current,
  onSelect,
}: {
  kind: GroupKind;
  item: Group;
  current: boolean;
  onSelect: () => void;
}) {
  const group = useGroup(item, kind);
  const first = item.books[0];
  return (
    <button
      type="button"
      className="group-pick"
      aria-current={current || undefined}
      onClick={onSelect}
    >
      <span className="group-pick-cover" aria-hidden="true">
        {first && (
          <BookCover
            actions={false}
            title={first.title}
            work={first}
            medium="ebook"
          />
        )}
      </span>
      <span className="group-pick-text">
        <span className="group-title">{item.name}</span>
        <Progress item={item} group={group} />
      </span>
    </button>
  );
}

function GroupDetail({
  kind,
  item,
  canEdit,
  medium,
  libraryId,
}: {
  kind: GroupKind;
  item: Group;
  canEdit: boolean;
  medium: Medium;
  libraryId?: string;
}) {
  const group = useGroup(item, kind);
  const follow = group.follow;
  const page = group.externalId
    ? `/${kind === "authors" ? "authors" : "series"}/hardcover/${encodeURIComponent(group.externalId)}`
    : null;
  return (
    <section className="group-detail" aria-labelledby="group-detail-title">
      <div className="group-detail-covers" aria-hidden="true">
        {item.books.slice(0, 6).map((work) => (
          <BookCover
            key={work.id}
            actions={false}
            title={work.title}
            work={work}
            medium="ebook"
          />
        ))}
      </div>
      <div className="group-detail-heading">
        <h3 id="group-detail-title" className="sr-only">
          {item.name}
        </h3>
        <GroupName item={item} group={group} large />
        {page && (
          <Link className="group-page-link" to={page}>
            {kind === "authors" ? "Author page" : "Series page"}{" "}
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
      <div className="group-detail-progress">
        <Progress item={item} group={group} />
        <span className="group-chips">
          <StatusChips group={group} />
        </span>
      </div>
      <div className="group-actions">
        <GroupActions item={item} group={group} canEdit={canEdit} />
        {follow && (
          <Link className="button-link" to={"/following/" + follow.list_id}>
            Open bookshelf
          </Link>
        )}
      </div>
      {follow ? (
        <FollowBooks
          follow={{
            list_id: follow.list_id,
            last_success_at: follow.subscription.last_success_at,
          }}
          selection="all"
        />
      ) : (
        <LibraryGroupBooks
          kind={kind}
          item={item}
          medium={medium}
          libraryId={libraryId}
        />
      )}
    </section>
  );
}

function LibraryGroupBooks({
  kind,
  item,
  medium,
  libraryId,
}: {
  kind: GroupKind;
  item: Group;
  medium: Medium;
  libraryId?: string;
}) {
  const books = useQuery({
    queryKey: [
      "library-group-books",
      kind,
      item.name,
      medium,
      libraryId,
      "detail",
    ],
    queryFn: async ({ signal }) =>
      result(
        await api.GET("/api/library/groups/{kind}/books", {
          signal,
          params: {
            path: { kind },
            query: {
              name: item.name,
              medium,
              library_id: libraryId,
              limit: 40,
            },
          },
        }),
      ),
  });
  return (
    <div className="group-detail-books">
      <p className="muted">
        {kind === "authors"
          ? "Follow this author to see every book they have written, with what is missing."
          : "Follow this series to see every book in it, with what is missing."}
      </p>
      <Notice error={books.error} />
      {books.isPending && <Loading />}
      <div className="book-grid">
        {books.data?.items.map((work) => (
          <BookCard key={work.id} work={work} medium={medium} />
        ))}
      </div>
    </div>
  );
}
