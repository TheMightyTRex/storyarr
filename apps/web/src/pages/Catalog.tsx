import { usePagedQuery } from "../hooks/usePagedQuery";
import InfiniteScroll from "../components/InfiniteScroll";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api, result } from "../api/client";
import { BookCard, Empty, Loading, Notice } from "../components";
import SectionToolbar, { SaveViewButton } from "../components/SectionToolbar";
import { useSavedView } from "../hooks/useSavedView";

export default function Catalog({ canEdit }: { canEdit: boolean }) {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const medium =
    params.get("medium") === "audio"
      ? "audio"
      : params.get("medium") === "ebook"
        ? "ebook"
        : "any";
  const client = useQueryClient();
  const view = useSavedView("saved");
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("offset");
    setParams(next);
  };
  const [adding, setAdding] = useState(false);
  const books = usePagedQuery({
    queryKey: ["works", q, medium],
    queryFn: async (offset, signal) =>
      result(
        await api.GET("/api/catalog/works", {
          params: { query: { q, medium, offset, limit: 30 } },
          signal,
        }),
      ),
    initial: 0,
    next: (last, pages) => {
      const count = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length && count < last.total ? count : undefined;
    },
  });
  const add = useMutation({
    mutationFn: async (form: HTMLFormElement) => {
      const values = new FormData(form);
      return result(
        await api.POST("/api/catalog/works", {
          body: {
            title: String(values.get("title")),
            authors: String(values.get("author")).trim()
              ? [String(values.get("author")).trim()]
              : [],
            description: String(values.get("description")) || null,
          },
        }),
      );
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["works"] });
      setAdding(false);
    },
  });
  return (
    <>
      <SectionToolbar
        title="All saved titles"
        summary={
          books.data
            ? `${books.data.total.toLocaleString("en-GB")} ${books.data.total === 1 ? "title" : "titles"}, including books saved from search and lists that you do not own`
            : "Loading…"
        }
        search={{
          label: "Search saved titles",
          placeholder: "Title or author",
          value: q,
          onSearch: (value) => change("q", value),
        }}
        chips={(
          [
            ["audio", "Audiobook in library"],
            ["ebook", "Ebook in library"],
          ] as const
        ).map(([key, label]) => ({
          key,
          label,
          pressed: medium === key,
          onToggle: () => change("medium", medium === key ? "" : key),
        }))}
        end={
          <>
            <SaveViewButton
              isDefault={view.isDefault}
              saving={view.saving}
              onSave={view.saveDefault}
            />
            {canEdit && (
              <button className="primary" onClick={() => setAdding(!adding)}>
                {adding ? <X size={17} /> : <Plus size={17} />}
                {adding ? "Close" : "Add a title"}
              </button>
            )}
          </>
        }
        applied={[
          ...(q
            ? [{ key: "q", label: `“${q}”`, onRemove: () => change("q", "") }]
            : []),
          ...(medium !== "any"
            ? [
                {
                  key: "medium",
                  label:
                    medium === "audio"
                      ? "Audiobook in library"
                      : "Ebook in library",
                  onRemove: () => change("medium", ""),
                },
              ]
            : []),
        ]}
        onClearAll={() => setParams({ view: "saved" })}
        showing={
          books.data && `Showing ${books.data.total.toLocaleString("en-GB")}`
        }
      />
      {adding ? (
        <form
          className="panel editor"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(e.currentTarget);
          }}
        >
          <h2>Add a title</h2>
          <p className="muted">
            Creates a catalog entry. It does not mark a book as downloaded.
          </p>
          <div className="form-row">
            <label>
              Title
              <input name="title" required maxLength={600} autoFocus />
            </label>
            <label>
              Author
              <input name="author" maxLength={300} />
            </label>
          </div>
          <label>
            Description
            <textarea name="description" rows={3} maxLength={30000} />
          </label>
          <Notice error={add.error} />
          <button className="primary" disabled={add.isPending}>
            {add.isPending ? "Saving…" : "Save title"}
          </button>
        </form>
      ) : null}
      <Notice error={books.error} />
      {books.isPending ? <Loading /> : null}
      {books.data ? (
        <>
          {books.data.items.length ? (
            <div className="book-grid">
              {books.data.items.map((work) => (
                <BookCard key={work.id} work={work} medium={medium} />
              ))}
            </div>
          ) : (
            <Empty
              title={
                q ? "No matching titles" : "A shelf waiting for your first book"
              }
            >
              {q
                ? "Try another title or author."
                : "Add a title to start organising your reading lists."}
            </Empty>
          )}
          <InfiniteScroll query={books} />
        </>
      ) : null}
    </>
  );
}
