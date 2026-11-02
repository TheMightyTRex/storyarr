import { Link } from "react-router-dom";
import { BookOpen, Headphones, Star } from "lucide-react";
import type { components } from "../api/schema";
import BookCover from "./BookCover";
import QuickAdd from "./QuickAdd";
import SidePanel from "./SidePanel";
import { useLocalBookMetadata, useReaderDetails } from "./BookReaderDetails";
import "../library-shelf.css";

type Work = components["schemas"]["WorkView"];

function hours(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Basic information about a library book, in a slide-out from the right. */
export default function BookSummary({
  work,
  close,
}: {
  work: Work;
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
        <Link className="drawer-action primary" to={`/books/${work.id}`}>
          Open book page
        </Link>
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
            {availability.ebook && (
              <span className="request-status" data-state="satisfied">
                <BookOpen size={13} aria-hidden="true" /> Ebook
              </span>
            )}
            {availability.audio && (
              <span className="request-status" data-state="satisfied">
                <Headphones size={13} aria-hidden="true" /> Audiobook
              </span>
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
