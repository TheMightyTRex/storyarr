import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, result } from "../api/client";
import FollowCatalog, { useFollowing } from "./FollowCatalog";
import {
  FollowBooks,
  statusChip,
  statusNames,
  type StatusKind,
} from "../pages/Following";

/** A library series card's follow control, book statuses and missing-book action. */
export default function SeriesFollowStatus({
  externalId,
  name,
}: {
  externalId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const following = useFollowing();
  const follow = following.data?.find(
    (f) => f.source_kind === "series" && f.external_id === externalId,
  );
  const counts = useQuery({
    queryKey: [
      "following",
      "books",
      follow?.list_id,
      follow?.subscription.last_success_at,
      "counts",
    ],
    enabled: !!follow,
    queryFn: async () =>
      result(
        await api.GET("/api/following/{list_id}/books", {
          params: { path: { list_id: follow!.list_id }, query: { limit: 1 } },
        }),
      ).status_counts,
  });
  const panel = `series-books-${externalId}`;
  return (
    <div className="library-series-status">
      <div className="library-series-actions">
        <FollowCatalog kind="series" externalId={externalId} name={name} />
        <Link
          className="reader-action-link"
          to={`/series/hardcover/${encodeURIComponent(externalId)}?request=1&gaps=1`}
        >
          Add missing books
        </Link>
      </div>
      {counts.data && (
        <p className="library-series-counts">
          {(Object.keys(statusNames) as StatusKind[])
            .filter((kind) => counts.data?.[kind])
            .map((kind) => (
              <span key={kind}>
                <span className="request-status" data-state={statusChip[kind]}>
                  {statusNames[kind]}
                </span>{" "}
                {counts.data?.[kind]}
              </span>
            ))}
        </p>
      )}
      {follow && (
        <button
          type="button"
          className="text-button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide books" : "Show every book"}
        </button>
      )}
      {follow && open && (
        <div id={panel}>
          <FollowBooks
            follow={{
              list_id: follow.list_id,
              last_success_at: follow.subscription.last_success_at,
            }}
            selection="all"
          />
        </div>
      )}
    </div>
  );
}
