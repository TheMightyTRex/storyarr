import StatusChip from "./StatusChip";
import { useQuery } from "@tanstack/react-query";
import { api, result } from "../api/client";
import { Link } from "react-router-dom";
import { ContextLink } from "./NavigationContinuity";
import { Star } from "lucide-react";
import type { components } from "../api/schema";
import BookCover, { resolveBookWork } from "./BookCover";
import QuickAdd from "./QuickAdd";
import SidePanel from "./SidePanel";
import { useLocalBookMetadata, useReaderDetails } from "./BookReaderDetails";
import "../library-shelf.css";

type Work = components["schemas"]["WorkView"];

/** What a cover knows about its book: enough for the Summary of a book that is not in the catalog yet. */
export type SummaryBook = {
  title: string;
  authors: string[];
  cover?: string | null;
  work?: Work | null;
  /** The catalog work's id, when the page has no whole work: the Summary reads it. */
  workId?: string;
  /** The book's own page, for "Open book page". */
  to: string;
  /** What the book's own page reads on arrival (see CoverCard). */
  toState?: Record<string, unknown>;
  rating?: number | null;
  providerBook?: { provider: string; external_id: string };
};

function hours(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Basic information about a book, in a slide-out from the right. Every cover opens it. */
export default function BookSummary({
  book,
  close,
}: {
  book: SummaryBook;
  close: () => void;
}) {
  const read = useQuery({
    queryKey: ["work", book.workId],
    enabled: !book.work && !!book.workId,
    queryFn: async () =>
      result(
        await api.GET("/api/catalog/works/{work_id}", {
          params: { path: { work_id: book.workId! } },
        }),
      ),
  });
  const work = book.work ?? read.data;
  return work ? (
    <WorkSummary work={work} to={book.to} close={close} />
  ) : (
    <CatalogSummary book={book} close={close} />
  );
}

/** A book that is not in the catalog yet: what the shelf knows, and the book page for the rest. */
function CatalogSummary({
  book,
  close,
}: {
  book: SummaryBook;
  close: () => void;
}) {
  const details = useReaderDetails(
    book.providerBook?.provider === "hardcover"
      ? book.providerBook.external_id
      : undefined,
  );
  const rating = details.data?.rating ?? book.rating;
  const published = details.data?.release_date?.slice(0, 4);
  const facts: [string, string][] = [];
  if (published) facts.push(["Published", published]);
  if (details.data?.audio_seconds)
    facts.push(["Length", hours(details.data.audio_seconds)]);
  if (details.data?.pages) facts.push(["Pages", String(details.data.pages)]);
  return (
    <SidePanel
      title="Summary"
      labelledBy="book-summary-title"
      closeLabel="Close summary"
      className="book-summary"
      onClose={close}
      footer={
        <ContextLink
          className="drawer-action primary"
          to={book.to}
          state={book.toState}
        >
          Open book page
        </ContextLink>
      }
    >
      <div className="side-panel__lead book-summary-head">
        <BookCover title={book.title} cover={book.cover} actions={false} />
        <div>
          <h3 id="book-summary-title">{book.title}</h3>
          <p className="muted">
            {book.authors.length
              ? book.authors.map((name, index) => (
                  <span key={`${name}:${index}`}>
                    {index > 0 ? ", " : ""}
                    <Link to={`/search?q=${encodeURIComponent(name)}`}>
                      {name}
                    </Link>
                  </span>
                ))
              : "Author unknown"}
          </p>
        </div>
      </div>
      {rating != null && (
        <p className="book-summary-rating">
          <Star size={14} aria-hidden="true" />
          {rating.toFixed(1)}
          {details.data?.ratings_count
            ? ` from ${details.data.ratings_count.toLocaleString()} ratings on Hardcover`
            : " average rating"}
        </p>
      )}
      {!!facts.length && (
        <dl className="book-summary-facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {book.providerBook && book.providerBook.provider !== "audible" && (
        <QuickAdd
          resolveWork={() => resolveBookWork(book.providerBook!)}
          actionLabel="Quick add"
        />
      )}
      <p className="muted">
        Open the book page for editions, reviews and every way to get it.
      </p>
    </SidePanel>
  );
}

function WorkSummary({
  work,
  to,
  close,
}: {
  work: Work;
  to: string;
  close: () => void;
}) {
  const metadata = useLocalBookMetadata(work.id);
  const hardcover = metadata.data?.sources?.find(
    (item) => item.provider === "hardcover",
  );
  const details = useReaderDetails(hardcover?.external_id);
  const series = (hardcover || metadata.data?.sources?.[0])?.series || [];
  const { availability } = work;
  const narrators = availability.primary_audio_narrators || [];
  const authorLink = (name: string) => {
    const author = details.data?.authors?.find(
      (item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    return author
      ? `/authors/hardcover/${author.external_id}`
      : `/search?q=${encodeURIComponent(name)}`;
  };
  const facts: [string, string][] = [];
  const published =
    details.data?.release_date?.slice(0, 4) || work.publication_year;
  if (published) facts.push(["Published", String(published)]);
  if (narrators.length) facts.push(["Narrated by", narrators.join(", ")]);
  if (details.data?.audio_seconds)
    facts.push(["Length", hours(details.data.audio_seconds)]);
  if (details.data?.pages) facts.push(["Pages", String(details.data.pages)]);
  return (
    <SidePanel
      title="Summary"
      labelledBy="book-summary-title"
      closeLabel="Close summary"
      className="book-summary"
      onClose={close}
      footer={
        <ContextLink className="drawer-action primary" to={to}>
          Open book page
        </ContextLink>
      }
    >
      <div className="side-panel__lead book-summary-head">
        <BookCover
          title={work.title}
          work={work}
          cover={work.cover_url}
          actions={false}
        />
        <div>
          <h3 id="book-summary-title">{work.title}</h3>
          <p className="muted">
            {work.authors.length
              ? work.authors.map((name, index) => (
                  <span key={`${name}:${index}`}>
                    {index > 0 ? ", " : ""}
                    <Link to={authorLink(name)}>{name}</Link>
                  </span>
                ))
              : "Author unknown"}
          </p>
          {series.map((item) => (
            <p key={item.external_id} className="muted">
              {hardcover ? (
                <Link
                  to={`/series/hardcover/${encodeURIComponent(item.external_id)}`}
                >
                  {item.name}
                </Link>
              ) : (
                item.name
              )}
              {item.position ? ` · Book ${item.position}` : ""}
            </p>
          ))}
          <div className="book-summary-formats" aria-label="In your library">
            {availability.ebook && <StatusChip label="In library · Ebook" />}
            {availability.audio && (
              <StatusChip label="In library · Audiobook" />
            )}
          </div>
        </div>
      </div>
      {details.data?.rating != null && (
        <p className="book-summary-rating">
          <Star size={14} aria-hidden="true" />
          {details.data.rating.toFixed(1)} from{" "}
          {(details.data.ratings_count || 0).toLocaleString()} ratings on
          Hardcover
        </p>
      )}
      {!!facts.length && (
        <dl className="book-summary-facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {work.description && (
        <p className="book-summary-description">{work.description}</p>
      )}
      {!(availability.ebook && availability.audio) && (
        <div>
          <QuickAdd
            workId={work.id}
            actionLabel={
              availability.audio ? "Get the ebook" : "Get the audiobook"
            }
          />
        </div>
      )}
    </SidePanel>
  );
}
