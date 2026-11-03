import { Fragment, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, result, type Auth } from "../api/client";
import { Loading, Notice } from "../components";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import type { components } from "../api/schema";
import { coverImage } from "../coverImages";
import AddMissingBooks from "./AddMissingBooks";
import FollowCatalog from "./FollowCatalog";
import LogoMask from "./LogoMask";
import LogoPanel, { type LogoCover } from "./LogoPanel";
import { longDate } from "../dates";

type SeriesView = components["schemas"]["SeriesView"];

/** A cover the cut-out canvas can read: Storyarr serves it from its own address. */
function readableCover(url: string | null | undefined) {
  return !!url && /^(https:\/\/|\/|data:image\/)/.test(url);
}

/** The first sentences, up to about 280 characters; the whole text is under About. */
function shortDescription(text: string) {
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
 * The series header (UX-43): the logo in one colour, or the name set large, with the author, the books,
 * the next book, a short description, how many you have, the actions and a fan of the first covers.
 * The series page and My library, Series (UX-47) both show it.
 */
export default function SeriesHeader({
  externalId,
  data,
  canEdit,
  canManageLogo,
  heading: Heading = "h1",
  actions,
}: {
  externalId: string;
  data: SeriesView;
  canEdit: boolean;
  /** Admins add, change and remove the series logo, which everyone sees. */
  canManageLogo: boolean;
  heading?: "h1" | "h2";
  /** More actions after Add missing books, Follow and the logo, such as a link to the series page. */
  actions?: ReactNode;
}) {
  const cache = useQueryClient();
  const [logoOpen, setLogoOpen] = useState(false);
  const [logoMessage, setLogoMessage] = useState("");
  const logo = data.logo ?? null;
  const authors = data.authors ?? [];
  const nextBook = data.items.find(
    (entry) =>
      entry.publication === "unreleased" && entry.category !== "collection",
  );
  const fan = data.items.filter((entry) => entry.work.cover_url).slice(0, 4);
  const covers: LogoCover[] = data.items
    .filter((entry) => readableCover(entry.work.cover_url))
    .slice(0, 12)
    .map((entry) => ({
      label: entry.position ? `Book ${entry.position}` : "Book",
      title: entry.work.title,
      url: coverImage(entry.work.cover_url!, 640),
    }));
  return (
    <>
      <header className="series-head">
        <div className="series-head__text">
          {logo && (
            <LogoMask url={logo.url} label={data.name} colour={logo.colour} />
          )}
          <Heading
            className={
              logo ? "series-head__name" : "series-head__name wordmark"
            }
          >
            {data.name}
          </Heading>
          <p className="series-head__meta">
            {authors.length > 0 && (
              <span>
                By{" "}
                {authors.map((author, index) => (
                  <Fragment key={author}>
                    {index > 0 &&
                      (index === authors.length - 1 ? " and " : ", ")}
                    <Link to={`/search?q=${encodeURIComponent(author)}`}>
                      {author}
                    </Link>
                  </Fragment>
                ))}
              </span>
            )}
            {data.fetched_at && (
              <span>
                <strong>
                  {data.books} {data.books === 1 ? "book" : "books"}
                </strong>
                {data.supplements > 0 &&
                  ` and ${data.supplements} supplementary ${data.supplements === 1 ? "book" : "books"}`}
              </span>
            )}
            {nextBook && (
              <span>
                Next: {nextBook.position ? `book ${nextBook.position}, ` : ""}
                {nextBook.work.title},{" "}
                {nextBook.release_date
                  ? longDate(nextBook.release_date.slice(0, 10))
                  : "date not announced"}
              </span>
            )}
          </p>
          {data.description && (
            <p className="series-head__desc">
              {shortDescription(data.description)}
            </p>
          )}
          {data.fetched_at && data.books > 0 && (
            <div className="series-head__progress series-ownership">
              <span>
                {data.owned} of {data.books} books in your library
                {data.owned > 0 &&
                  ` (${data.ebook} ${data.ebook === 1 ? "ebook" : "ebooks"}, ${data.audio} ${data.audio === 1 ? "audiobook" : "audiobooks"})`}
              </span>
              <div
                className="series-ownership-track"
                role="meter"
                aria-label="Series books in your library"
                aria-valuemin={0}
                aria-valuemax={data.books}
                aria-valuenow={Math.min(data.owned, data.books)}
              >
                <span
                  style={{
                    width: `${Math.min(100, (data.owned / data.books) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
          {(canEdit || canManageLogo || actions) && (
            <div className="series-head__actions entity-follow-actions">
              {canEdit && (
                <>
                  <AddMissingBooks
                    kind="series"
                    externalId={externalId}
                    name={data.name}
                  />
                  <FollowCatalog
                    kind="series"
                    externalId={externalId}
                    name={data.name}
                  />
                </>
              )}
              {canManageLogo && (
                <button
                  type="button"
                  className="btn btn--quiet"
                  aria-haspopup="dialog"
                  onClick={() => setLogoOpen(true)}
                >
                  {logo ? "Change logo" : "Add a logo"}
                </button>
              )}
              {actions}
            </div>
          )}
          {logoMessage && (
            <p className="small muted" role="status">
              {logoMessage}
            </p>
          )}
          <div className="reader-outbound">
            <a
              href={`https://hardcover.app/series/${encodeURIComponent(externalId)}`}
              target="_blank"
              rel="noreferrer"
            >
              View on Hardcover <ExternalLink size={13} />
            </a>
          </div>
        </div>
        {fan.length > 0 && (
          <div className="cover-fan" aria-hidden="true">
            {fan.map((entry) => (
              <img
                key={entry.membership_id}
                src={coverImage(entry.work.cover_url!, 320)}
                alt=""
              />
            ))}
          </div>
        )}
      </header>
      {logoOpen && (
        <LogoPanel
          target={{ kind: "series", externalId }}
          name={data.name}
          people={authors}
          logo={logo}
          covers={covers}
          onClose={() => setLogoOpen(false)}
          onChanged={(message) => {
            setLogoMessage(message);
            void cache.invalidateQueries({ queryKey: ["series", externalId] });
            void cache.invalidateQueries({
              queryKey: ["series-header", externalId],
            });
          }}
        />
      )}
    </>
  );
}

/**
 * The series header for My library, Series (UX-47, option A): the same header as the series page, read
 * on its own, with a link to the series page for the reading order, requests and lists.
 */
export function SeriesPaneHeader({
  externalId,
  canEdit,
  extra,
}: {
  externalId: string;
  canEdit: boolean;
  extra?: ReactNode;
}) {
  const { data: session } = useQuery<Auth | null>({
    queryKey: ["session"],
    enabled: false,
  });
  const series = useQuery({
    queryKey: ["series-header", externalId],
    queryFn: async ({ signal }) =>
      result(
        await api.GET("/api/catalog/series/hardcover/{external_id}", {
          signal,
          params: {
            path: { external_id: externalId },
            query: { offset: 0, limit: 50, section: "main" },
          },
        }),
      ),
  });
  const page = `/series/hardcover/${encodeURIComponent(externalId)}`;
  if (series.isPending) return <Loading />;
  if (!series.data) return <Notice error={series.error} />;
  return (
    <SeriesHeader
      externalId={externalId}
      data={series.data}
      canEdit={canEdit}
      canManageLogo={session?.user.role === "admin"}
      heading="h2"
      actions={
        <>
          <Link className="btn btn--quiet" to={page}>
            Series page
          </Link>
          {extra}
        </>
      }
    />
  );
}
