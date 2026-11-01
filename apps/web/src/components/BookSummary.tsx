import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Headphones, Star, X } from "lucide-react";
import type { components } from "../api/schema";
import BookCover from "./BookCover";
import QuickAdd from "./QuickAdd";
import { useLocalBookMetadata, useReaderDetails } from "./BookReaderDetails";
import "../library-shelf.css";

type Work = components["schemas"]["WorkView"];

function hours(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Basic information about a library book, sliding out from the right. */
export default function BookSummary({
  work,
  close,
}: {
  work: Work;
  close: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Slide out from the right edge of the page, below the header.
  const [edges, setEdges] = useState<{ top: number }>();
  useLayoutEffect(() => {
    const place = () => {
      const header = document.querySelector(".topbar");
      setEdges({
        top: Math.max(0, header?.getBoundingClientRect().bottom || 0),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, []);
  const metadata = useLocalBookMetadata(work.id);
  const hardcover = metadata.data?.sources?.find(
    (item) => item.provider === "hardcover",
  );
  const details = useReaderDetails(hardcover?.external_id);
  const series = (hardcover || metadata.data?.sources?.[0])?.series || [];
  const { availability } = work;
  const narrators = availability.primary_audio_narrators || [];
  useEffect(() => {
    heading.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [work.id, close]);
  const facts: [string, string][] = [];
  const published =
    details.data?.release_date?.slice(0, 4) || work.publication_year;
  if (published) facts.push(["Published", String(published)]);
  if (narrators.length) facts.push(["Narrated by", narrators.join(", ")]);
  if (details.data?.audio_seconds)
    facts.push(["Length", hours(details.data.audio_seconds)]);
  if (details.data?.pages) facts.push(["Pages", String(details.data.pages)]);
  return (
    <aside
      className="book-summary"
      aria-labelledby="book-summary-title"
      style={edges}
    >
      <header className="book-summary-top">
        <span>Summary</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Close summary"
          onClick={close}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="book-summary-head">
        <BookCover
          title={work.title}
          work={work}
          cover={work.cover_url}
          actions={false}
        />
        <div>
          <h2 id="book-summary-title" ref={heading} tabIndex={-1}>
            {work.title}
          </h2>
          <p className="muted">{work.authors.join(", ") || "Author unknown"}</p>
          {series.map((item) => (
            <p key={item.external_id} className="muted">
              {item.name}
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
      <div className="book-summary-actions">
        <Link className="button-link primary" to={`/books/${work.id}`}>
          Open book page
        </Link>
        {!(availability.ebook && availability.audio) && (
          <QuickAdd
            workId={work.id}
            actionLabel={
              availability.audio ? "Get the ebook" : "Get the audiobook"
            }
          />
        )}
      </div>
    </aside>
  );
}
