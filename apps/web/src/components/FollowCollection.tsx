import { useState } from "react";
import { Link } from "react-router-dom";
import { UserRound } from "lucide-react";
import type { components } from "../api/schema";
import BookCover from "./BookCover";
import AddMissingBooks from "./AddMissingBooks";
import { FollowShelfView } from "../pages/FollowShelf";
import "../collection-views.css";

type Summary = components["schemas"]["FollowSummary"];

function picture(follow: Summary) {
  return follow.image_url
    ? "/api/catalog/cover-image?url=" + encodeURIComponent(follow.image_url)
    : undefined;
}

function FollowName({
  follow,
  large = false,
}: {
  follow: Summary;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = picture(follow);
  return (
    <span className={large ? "group-name is-large" : "group-name"}>
      <span className="group-picture" aria-hidden="true">
        {src && !failed ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <UserRound size={large ? 22 : 16} />
        )}
      </span>
      <span className="group-name-text">
        <span className="group-title">{follow.name}</span>
        <span className="group-byline">
          {follow.source_kind === "author" ? "Author" : "Series"}
        </span>
      </span>
    </span>
  );
}

function FollowProgress({ follow }: { follow: Summary }) {
  // Released books only, like the bookshelf, so both show the same numbers.
  const owned = follow.library_books;
  const total =
    follow.total_books == null
      ? null
      : follow.total_books - (follow.upcoming_books ?? 0);
  if (owned == null || !total)
    return (
      <span className="group-progress">
        <span>{owned ?? 0} in your library</span>
      </span>
    );
  const percent = Math.round((owned / total) * 100);
  return (
    <span className="group-progress">
      <span>
        {owned} of {total}
      </span>
      <span
        className="group-bar"
        role="progressbar"
        aria-label={`${owned} of ${total} books in your library`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          data-complete={owned >= total || undefined}
          style={{ width: `${percent}%` }}
        />
      </span>
    </span>
  );
}

function FollowChips({ follow }: { follow: Summary }) {
  const busy = ["queued", "running"].includes(follow.state);
  const chips: [string, string][] = [];
  if (!follow.enabled) chips.push(["paused", "Updates paused"]);
  else if (busy) chips.push(["downloading", "Updating"]);
  else if (follow.state === "failed") chips.push(["failed", "Update failed"]);
  if (follow.missing_books)
    chips.push(["paused", `${follow.missing_books} missing`]);
  if (follow.upcoming_books)
    chips.push(["waiting", `${follow.upcoming_books} not released`]);
  if (!chips.length && follow.total_books)
    chips.push(["satisfied", "Complete"]);
  return (
    <>
      {chips.map(([state, label]) => (
        <span key={label} className="request-status" data-state={state}>
          {label}
        </span>
      ))}
    </>
  );
}

function FollowActions({ follow }: { follow: Summary }) {
  return (
    <>
      <AddMissingBooks
        kind={follow.source_kind}
        externalId={follow.external_id}
        name={follow.name}
      />
      <Link
        className="button-link"
        to={"/following?list=" + follow.list_id}
        aria-label={`Manage ${follow.name}`}
      >
        Manage
      </Link>
    </>
  );
}

/** Layout A for Following: one aligned row per follow. */
export function FollowListView({
  follows,
  label,
}: {
  follows: Summary[];
  label: string;
}) {
  return (
    <div className="group-table" role="table" aria-label={label}>
      <div className="group-row group-head" role="row">
        <span role="columnheader">Latest books</span>
        <span role="columnheader">Following</span>
        <span role="columnheader">In your library</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" className="group-actions-head">
          Actions
        </span>
      </div>
      {follows.map((follow) => (
        <div className="group-row" role="row" key={follow.list_id}>
          <span className="group-covers" role="cell" aria-hidden="true">
            {(follow.latest_books ?? []).slice(0, 3).map((book) => (
              <BookCover
                key={book.work_id}
                actions={false}
                title={book.title}
                cover={book.cover_url}
              />
            ))}
          </span>
          <span role="cell" className="group-cell-name">
            <Link
              to={"/following/" + follow.list_id}
              aria-label={`${follow.name}, open bookshelf`}
            >
              <FollowName follow={follow} />
            </Link>
          </span>
          <span role="cell">
            <FollowProgress follow={follow} />
          </span>
          <span role="cell" className="group-chips">
            <FollowChips follow={follow} />
          </span>
          <span role="cell" className="group-actions">
            <FollowActions follow={follow} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Layout D for Following: the follows beside the chosen follow's bookshelf. */
export function FollowDetailView({
  follows,
  label,
  selected,
  onSelect,
  more,
}: {
  follows: Summary[];
  label: string;
  selected?: string;
  onSelect: (listId: string) => void;
  more: React.ReactNode;
}) {
  const current =
    follows.find((follow) => follow.list_id === selected) || follows[0];
  return (
    <div className="group-split">
      <nav className="group-picker" aria-label={label}>
        <ul>
          {follows.map((follow) => (
            <li key={follow.list_id}>
              <button
                type="button"
                className="group-pick"
                aria-current={follow.list_id === current?.list_id || undefined}
                onClick={() => onSelect(follow.list_id)}
              >
                <span className="group-pick-cover" aria-hidden="true">
                  {follow.latest_books?.[0] && (
                    <BookCover
                      actions={false}
                      title={follow.latest_books[0].title}
                      cover={follow.latest_books[0].cover_url}
                    />
                  )}
                </span>
                <span className="group-pick-text">
                  <span className="group-title">{follow.name}</span>
                  <FollowProgress follow={follow} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        {more}
      </nav>
      {current && (
        <section
          className="group-detail follow-detail"
          aria-label={current.name}
        >
          {/* A finished catalog refresh changes the revision, so the bookshelf shows the new books. */}
          <FollowShelfView
            key={current.list_id}
            listId={current.list_id}
            revision={current.last_success_at}
            embedded
          />
        </section>
      )}
    </div>
  );
}
