import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Notice } from "../components";
import IdentityHistory from "../pages/IdentityHistory";
import { searchTitle, titlePart } from "../titleLabels";

type Asset = components["schemas"]["AssetView"];
type Book = components["schemas"]["BookData"];
// An Audible recording that is not in the catalog yet is chosen as "audible:<ASIN>" and imported on save.
const AUDIBLE = "audible:";

type Part = [number, number] | null;

export function useAssetMatch(
  asset: Asset,
  done: (workId: string | null) => void,
) {
  const cache = useQueryClient();
  return useMutation({
    // `part` undefined keeps the part number the title gives, if any.
    mutationFn: async ({ id, part }: { id: string | null; part?: Part }) =>
      result(
        await api.POST("/api/library/assets/{asset_id}/match", {
          params: { path: { asset_id: asset.id } },
          body: {
            work_id: id,
            expected_revision: asset.match_revision,
            part_index: part ? part[0] : null,
            part_total: part ? part[1] : null,
            whole_book: part === null,
          },
        }),
      ),
    onSuccess: async (_, { id }) => {
      done(id);
      await Promise.all(
        [
          "library-books",
          "library-review",
          "work",
          "works",
          "requests",
          "assets",
          "identity-history",
        ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
}

export default function AssetMatchForm({
  asset,
  close,
  onMatched = close,
  heading = true,
  continueReview = false,
}: {
  asset: Asset;
  close: () => void;
  onMatched?: (workId: string | null) => void;
  heading?: boolean;
  continueReview?: boolean;
}) {
  const [search, setSearch] = useState(searchTitle(asset.title));
  const [workId, setWorkId] = useState(asset.work_ids[0] || "");
  const [part, setPart] = useState<Part>(
    asset.part_index && asset.part_total
      ? [asset.part_index, asset.part_total]
      : titlePart(asset.title),
  );
  const [query, setQuery] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const works = useQuery({
    queryKey: ["match-search", query],
    queryFn: async ({ signal }) =>
      result(
        await api.GET("/api/catalog/works", {
          params: { query: { q: query, limit: 30 } },
          signal,
        }),
      ),
    enabled: query.length > 1,
    staleTime: 30_000,
  });
  const match = useAssetMatch(asset, onMatched);
  const importBook = useMutation({
    mutationFn: async (externalId: string) =>
      result(
        await api.POST("/api/metadata/books/{provider}/{external_id}/import", {
          params: { path: { provider: "audible", external_id: externalId } },
        }),
      ),
  });
  return (
    <form
      className="panel editor"
      onSubmit={async (event) => {
        event.preventDefault();
        let id = workId;
        if (id.startsWith(AUDIBLE))
          id = (await importBook.mutateAsync(id.slice(AUDIBLE.length))).id;
        match.mutate({ id, part });
      }}
    >
      {heading && <h2>Match {asset.title}</h2>}
      <p className="muted">
        Your correction is preserved during future syncs. Confirming a match
        also accepts the current edition or recording details.
      </p>
      <Notice error={works.error || match.error || importBook.error} />
      {asset.work_ids.length > 1 && (
        <p className="notice">
          This replaces all current book associations for this library item. The
          correction history can restore them.
        </p>
      )}
      <label>
        Search catalog
        <input
          value={search}
          maxLength={300}
          onChange={(event) => {
            setSearch(event.target.value);
            setWorkId("");
          }}
        />
      </label>
      <fieldset
        className="match-candidates"
        disabled={match.isPending || query !== search.trim()}
      >
        <legend>Choose the correct book</legend>
        {works.isFetching && <p role="status">Searching catalog…</p>}
        {works.data?.items.map((work) => (
          <label key={work.id} className="match-candidate">
            <input
              type="radio"
              name="matched-book"
              value={work.id}
              checked={workId === work.id}
              onChange={() => setWorkId(work.id)}
              required
            />
            <span>
              <strong>{work.title}</strong>
              <small>{work.authors.join(", ") || "Unknown author"}</small>
            </span>
          </label>
        ))}
        {!!works.data && works.data.total > works.data.items.length && (
          <p className="muted">
            Showing {works.data.items.length} of {works.data.total} matches.
            Refine the title or author to narrow the choices.
          </p>
        )}
        {works.isSuccess && !works.data.items.length && (
          <p>No catalog matches. Try another title or search Audible.</p>
        )}
        {asset.medium !== "ebook" && (
          <AudibleCandidates
            key={query}
            query={query}
            narrators={asset.narrators}
            selected={workId}
            choose={setWorkId}
          />
        )}
      </fieldset>
      <label className="check-label">
        <input
          type="checkbox"
          checked={!!part}
          onChange={(event) => setPart(event.target.checked ? [1, 2] : null)}
        />
        This item is one part of the book
      </label>
      {part && (
        <fieldset className="part-number">
          <legend className="sr-only">Part number</legend>
          <label>
            Part
            <input
              type="number"
              min={1}
              max={part[1]}
              value={part[0]}
              onChange={(event) =>
                setPart([Number(event.target.value) || 1, part[1]])
              }
              required
            />
          </label>
          <label>
            of
            <input
              type="number"
              min={Math.max(2, part[0])}
              max={20}
              value={part[1]}
              onChange={(event) =>
                setPart([part[0], Number(event.target.value) || 2])
              }
              required
            />
          </label>
          <p className="muted">
            The book counts as in your library only when every part is.
          </p>
        </fieldset>
      )}
      <div className="button-row">
        <button
          className="primary"
          disabled={
            !workId ||
            match.isPending ||
            importBook.isPending ||
            query !== search.trim()
          }
        >
          {continueReview ? "Save and review next" : "Confirm match"}
        </button>
        <button
          type="button"
          disabled={match.isPending}
          onClick={() => match.mutate({ id: null })}
        >
          Leave unmatched
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
      <IdentityHistory entityId={asset.id} onChanged={close} />
    </form>
  );
}

function runtime(minutes: number | null | undefined) {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/** Audible recordings for the search, with narrators and length to help pick the right one. */
function AudibleCandidates({
  query,
  narrators,
  selected,
  choose,
}: {
  query: string;
  narrators: string[];
  selected: string;
  choose: (id: string) => void;
}) {
  const [asked, setAsked] = useState(false);
  const audible = useQuery({
    queryKey: ["match-search-audible", query],
    queryFn: async ({ signal }) =>
      result(
        await api.GET("/api/metadata/search", {
          params: { query: { q: query, provider: "audible" } },
          signal,
        }),
      ),
    enabled: asked && query.length > 1,
    staleTime: 300_000,
  });
  const ours = new Set(narrators.map((name) => name.toLowerCase()));
  if (!asked)
    return (
      <div className="audible-search">
        <button
          type="button"
          onClick={() => setAsked(true)}
          disabled={query.length < 2}
        >
          Search Audible
        </button>
        <p className="muted">
          Audible results show the narrator and length of each recording.
        </p>
      </div>
    );
  return (
    <div className="audible-search">
      <h3>Audible results</h3>
      <Notice error={audible.error} />
      {audible.isFetching && <p role="status">Searching Audible…</p>}
      {audible.isSuccess && !audible.data.items.length && (
        <p>Audible has no results for this search.</p>
      )}
      {audible.data?.items.map((book: Book) => {
        const known = audible.data.known_works?.[book.external_id];
        const value = known ? known.id : AUDIBLE + book.external_id;
        const edition = book.editions?.[0];
        const voices = edition?.narrators ?? [];
        const sameVoice = voices.some((name) => ours.has(name.toLowerCase()));
        const length = runtime(edition?.runtime_minutes);
        const series = book.series?.[0];
        return (
          <label
            key={book.external_id}
            className="match-candidate audible-candidate"
          >
            <input
              type="radio"
              name="matched-book"
              value={value}
              checked={selected === value}
              onChange={() => choose(value)}
              required
            />
            {book.cover_url ? (
              <img
                src={
                  "/api/catalog/cover-image?url=" +
                  encodeURIComponent(book.cover_url)
                }
                alt=""
                loading="lazy"
              />
            ) : (
              <span className="audible-cover" aria-hidden="true" />
            )}
            <span>
              <strong>{book.title}</strong>
              <small>{book.authors?.join(", ") || "Unknown author"}</small>
              {!!voices.length && (
                <small>Narrated by {voices.join(", ")}</small>
              )}
              <small>
                {[
                  length,
                  book.publication_year,
                  series &&
                    `${series.name}${series.position ? ` #${series.position}` : ""}`,
                  `ASIN ${book.external_id}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
              <span className="audible-tags">
                {sameVoice && (
                  <span className="audible-tag">Narrator matches</span>
                )}
                {known && <span className="audible-tag">In your catalog</span>}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
