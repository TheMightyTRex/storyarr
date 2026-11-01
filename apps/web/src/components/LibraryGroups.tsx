import { usePagedQuery } from "../hooks/usePagedQuery";
import InfiniteScroll from "./InfiniteScroll";
import { ArrowLeft } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { BookCard, Empty, Loading, Notice } from "../components";
import {
  collectionSorts,
  CollectionViewSwitch,
  GroupDetailView,
  GroupListView,
  readSort,
  useCollectionView,
} from "./GroupShelf";
import SectionToolbar, { SaveViewButton } from "./SectionToolbar";
import { useSavedView } from "../hooks/useSavedView";

type Kind = "authors" | "series";
type Library = components["schemas"]["LibraryView"];
export default function LibraryGroups({
  kind,
  libraries,
  canEdit = false,
}: {
  kind: Kind;
  libraries: Library[];
  canEdit?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const group = params.get("group") || "";
  const q = (params.get("q") || "").slice(0, 300);
  const rawLibrary = params.get("library") || "";
  const libraryId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      rawLibrary,
    )
      ? rawLibrary
      : undefined;
  const medium =
    params.get("medium") === "ebook"
      ? "ebook"
      : params.get("medium") === "audio"
        ? "audio"
        : "any";
  const { sort, reverse } = readSort(params, "name");
  const rawOffset = Number(params.get("offset"));
  const offset =
    Number.isSafeInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  const title = kind === "authors" ? "Authors" : "Series";
  const query = usePagedQuery({
    queryKey: ["library-groups", kind, q, medium, libraryId, sort, reverse],
    initial: 0,
    enabled: !group,
    queryFn: async (offset, signal) =>
      result(
        await api.GET("/api/library/groups/{kind}", {
          signal,
          params: {
            path: { kind },
            query: {
              q,
              medium,
              library_id: libraryId,
              sort,
              reverse,
              offset,
              limit: 24,
            },
          },
        }),
      ),
    next: (last, pages) => {
      const count = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length && count < last.total ? count : undefined;
    },
  });
  const books = usePagedQuery({
    queryKey: ["library-group-books", kind, group, medium, libraryId],
    initial: 0,
    enabled: !!group,
    queryFn: async (offset, signal) =>
      result(
        await api.GET("/api/library/groups/{kind}/books", {
          signal,
          params: {
            path: { kind },
            query: {
              name: group,
              medium,
              library_id: libraryId,
              offset,
              limit: 40,
            },
          },
        }),
      ),
    next: (last, pages) => {
      const count = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length && count < last.total ? count : undefined;
    },
  });
  const active = group ? books : query;
  const layout = useCollectionView();
  const saved = useSavedView(kind);
  const picked = params.get("pick") || undefined;
  const groupLink = (item: { name: string }) => {
    const next = new URLSearchParams(params);
    next.set("group", item.name);
    next.delete("offset");
    next.delete("pick");
    return `?${next}`;
  };
  const total = active.data?.total || 0;
  // Start from the address as it is now, not as it was at the last render,
  // so a quick change after switching tab keeps the new tab.
  const current = () => new URLSearchParams(window.location.search);
  const change = (key: string, value: string) => {
    const next = current();
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "offset") next.delete("offset");
    setParams(next);
  };
  const back = new URLSearchParams(params);
  back.delete("group");
  back.delete("offset");
  return (
    <section className="library-group-shelf" aria-label={`Library ${kind}`}>
      {group && (
        <Link className="back-link" to={`?${back}`}>
          <ArrowLeft size={16} /> All {kind}
        </Link>
      )}
      <SectionToolbar
        title={group || title}
        summary={
          active.data && !active.error
            ? `${total.toLocaleString("en-GB")} ${
                group
                  ? total === 1
                    ? "book"
                    : "books"
                  : kind === "authors"
                    ? total === 1
                      ? "author"
                      : "authors"
                    : "series"
              }`
            : "Loading…"
        }
        view={
          !group && (
            <CollectionViewSwitch
              view={layout.view}
              onChange={layout.setView}
            />
          )
        }
        search={
          group
            ? undefined
            : {
                label: `Search ${kind}`,
                placeholder: kind === "authors" ? "Author name" : "Series name",
                value: q,
                onSearch: (value) => change("q", value),
              }
        }
        chips={(
          [
            ["audio", "Audiobooks"],
            ["ebook", "Ebooks"],
          ] as const
        ).map(([key, label]) => ({
          key,
          label,
          pressed: medium === key,
          onToggle: () => change("medium", medium === key ? "" : key),
        }))}
        menus={[
          {
            key: "library",
            label: "Library",
            value: libraryId || "",
            emptyValue: "",
            options: [
              { value: "", label: "All libraries" },
              ...libraries.map((library) => ({
                value: library.id,
                label: library.name,
              })),
            ],
            onChange: (value) => change("library", value),
          },
        ]}
        sort={
          group
            ? undefined
            : {
                key: "sort",
                value: sort,
                options: collectionSorts.map(([value, label]) => ({
                  value,
                  label,
                })),
                onChange: (value) => change("sort", value),
                reverse: {
                  pressed: reverse,
                  onToggle: () => change("reverse", reverse ? "" : "1"),
                },
              }
        }
        applied={[
          ...(q
            ? [{ key: "q", label: `“${q}”`, onRemove: () => change("q", "") }]
            : []),
          ...(medium !== "any"
            ? [
                {
                  key: "medium",
                  label: medium === "audio" ? "Audiobooks" : "Ebooks",
                  onRemove: () => change("medium", ""),
                },
              ]
            : []),
          ...(libraryId
            ? [
                {
                  key: "library",
                  label:
                    libraries.find((library) => library.id === libraryId)
                      ?.name || "One library",
                  onRemove: () => change("library", ""),
                },
              ]
            : []),
        ]}
        end={
          !group && (
            <SaveViewButton
              isDefault={saved.isDefault}
              saving={saved.saving}
              onSave={saved.saveDefault}
            />
          )
        }
        onClearAll={() =>
          setParams({ view: kind, ...(group ? { group } : {}) })
        }
        showing={active.data && `Showing ${total.toLocaleString("en-GB")}`}
      />
      <Notice error={active.error} />
      {active.isPending && <Loading />}
      {active.error && (
        <button onClick={() => active.refetch()} disabled={active.isFetching}>
          Retry {kind}
        </button>
      )}
      {!active.error && active.data && (
        <>
          {group ? (
            <div className="book-grid">
              {books.data?.items.map((work) => (
                <BookCard key={work.id} work={work} medium={medium} />
              ))}
            </div>
          ) : layout.view === "detail" ? (
            <GroupDetailView
              kind={kind}
              items={query.data?.items ?? []}
              selected={picked}
              onSelect={(key) => {
                const next = current();
                next.set("pick", key);
                setParams(next, { replace: true });
              }}
              canEdit={canEdit}
              medium={medium}
              libraryId={libraryId}
              more={<InfiniteScroll query={active} />}
            />
          ) : (
            <GroupListView
              kind={kind}
              items={query.data?.items ?? []}
              canEdit={canEdit}
              groupLink={groupLink}
            />
          )}
          {!active.data.items.length && (
            <Empty
              title={group ? "No books match this view" : `No ${kind} to show`}
            >
              {q || medium !== "any" || libraryId || offset
                ? "Try clearing the filters."
                : kind === "series"
                  ? "Series appear when books in your libraries have series metadata. You can check a book’s metadata from its detail page."
                  : "Authors appear here when matched books are available in your libraries."}
            </Empty>
          )}
          {(group || layout.view !== "detail") && (
            <InfiniteScroll query={active} />
          )}
        </>
      )}
    </section>
  );
}
