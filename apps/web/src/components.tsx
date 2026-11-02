import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";
import type { Work } from "./api/client";
import CoverCard from "./components/CoverCard";

export function Notice({ error }: { error: Error | null }) {
  return error ? (
    <p className="notice error" role="alert">
      {error.message}
    </p>
  ) : null;
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <BookOpen size={36} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="loading-spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

/** A catalog book's cover and title: the cover opens its Summary, with the cover actions (UX-42). */
export function BookCard({
  work,
  to,
  cover,
  medium,
  rating,
}: {
  work: Work;
  rating?: number | null;
  to?: string;
  cover?: string | null;
  medium?: "any" | "ebook" | "audio";
}) {
  return (
    <CoverCard
      title={work.title}
      authors={work.authors}
      work={work}
      cover={cover}
      medium={medium}
      rating={rating}
      to={to || `/books/${work.id}`}
    />
  );
}
