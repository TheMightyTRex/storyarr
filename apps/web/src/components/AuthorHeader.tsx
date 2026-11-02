import { useState, type ReactNode, type Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink, UserRound } from "lucide-react";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Loading, Notice } from "../components";
import { coverImage } from "../coverImages";
import AddMissingBooks from "./AddMissingBooks";
import FollowCatalog from "./FollowCatalog";

type Author = components["schemas"]["AuthorDetails"];
type Book = components["schemas"]["BookData"];

/** The first sentences, up to about 280 characters; the whole biography is under About. */
function shortBio(text: string) {
  const sentences = text.trim().match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [
    text,
  ];
  let out = "";
  for (const sentence of sentences) {
    if (out && out.length + sentence.length > 280) break;
    out += sentence;
  }
  return out.trim();
}

/**
 * The author header, on the same design as the series header (UX-43, UX-47): the portrait beside the
 * name set large, a meta line, a short biography, the actions and a fan of the first covers. The author
 * page and My library, Authors both show it.
 */
export default function AuthorHeader({
  externalId,
  author,
  books,
  canEdit,
  heading: Heading = "h1",
  headingRef,
  meta,
  actions,
}: {
  externalId: string;
  author: Author;
  books: Book[];
  canEdit: boolean;
  heading?: "h1" | "h2";
  headingRef?: Ref<HTMLHeadingElement>;
  /** Facts for the meta line, such as how many of their books are in your library. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const fan = books.filter((book) => book.cover_url).slice(0, 4);
  return (
    <header className="series-head author-head">
      <div className="series-head__text">
        <div className="author-head__name">
          <span className="author-head__portrait">
            {author.image_url && !imageFailed ? (
              <img
                src={author.image_url}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <UserRound size={40} aria-hidden="true" />
            )}
          </span>
          <Heading
            ref={headingRef}
            tabIndex={headingRef ? -1 : undefined}
            className="series-head__name wordmark"
          >
            {author.name}
          </Heading>
        </div>
        {meta && <p className="series-head__meta">{meta}</p>}
        {author.bio && (
          <p className="series-head__desc">{shortBio(author.bio)}</p>
        )}
        {(canEdit || actions) && (
          <div className="series-head__actions entity-follow-actions">
            {canEdit && (
              <>
                <FollowCatalog
                  kind="author"
                  externalId={externalId}
                  name={author.name}
                />
                <AddMissingBooks
                  kind="author"
                  externalId={externalId}
                  name={author.name}
                />
              </>
            )}
            {actions}
          </div>
        )}
        <div className="reader-outbound">
          <a
            href={`https://hardcover.app/authors/${encodeURIComponent(author.slug || externalId)}`}
            target="_blank"
            rel="noreferrer"
          >
            View on Hardcover <ExternalLink size={13} />
          </a>
        </div>
      </div>
      {fan.length > 0 && (
        <div className="cover-fan" aria-hidden="true">
          {fan.map((book) => (
            <img
              key={book.external_id}
              src={coverImage(book.cover_url!, 320)}
              alt=""
            />
          ))}
        </div>
      )}
    </header>
  );
}

/**
 * The author header for My library, Authors: read on its own, with a link to the author page for every
 * book and the biography.
 */
export function AuthorPaneHeader({
  externalId,
  canEdit,
  owned,
  extra,
}: {
  externalId: string;
  canEdit: boolean;
  /** How many of their books are in your libraries. */
  owned: number;
  extra?: ReactNode;
}) {
  const author = useQuery({
    queryKey: ["author-header", externalId],
    staleTime: 300_000,
    retry: false,
    queryFn: async ({ signal }) =>
      result(
        await api.GET("/api/metadata/authors/hardcover/{external_id}", {
          params: { path: { external_id: externalId }, query: { page: 1 } },
          signal,
        }),
      ),
  });
  const page = `/authors/hardcover/${encodeURIComponent(externalId)}`;
  if (author.isPending) return <Loading />;
  if (!author.data?.author) return <Notice error={author.error} />;
  return (
    <AuthorHeader
      externalId={externalId}
      author={author.data.author}
      books={author.data.books}
      canEdit={canEdit}
      heading="h2"
      meta={
        <span>
          <strong>
            {owned} {owned === 1 ? "book" : "books"}
          </strong>{" "}
          in your library
        </span>
      }
      actions={
        <>
          <Link className="btn btn--quiet" to={page}>
            Author page
          </Link>
          {extra}
        </>
      }
    />
  );
}
