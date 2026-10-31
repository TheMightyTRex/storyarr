import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Notice } from "../components";
import BookDialog from "./BookDialog";

type Asset = components["schemas"]["AssetView"];

/** Admin-only delete for a library copy, with the files held for the retention period by default. */
export default function DeleteLibraryCopy({
  asset,
  close,
}: {
  asset: Pick<Asset, "id" | "title" | "library_name">;
  close: () => void;
}) {
  const cache = useQueryClient();
  const [files, setFiles] = useState<"hold" | "delete">("hold");
  const [forget, setForget] = useState(true);
  const [typed, setTyped] = useState("");
  const retention = useQuery({
    queryKey: ["automation-installation"],
    queryFn: async () =>
      result(await api.GET("/api/automation/settings/installation")),
  });
  const days = retention.data?.settings.deleted_retention_days;
  const remove = useMutation({
    mutationFn: async () =>
      result(
        await api.POST("/api/library/assets/{asset_id}/delete", {
          params: { path: { asset_id: asset.id } },
          body: { files, forget },
        }),
      ),
    onSuccess: () => {
      for (const key of ["assets", "library", "following", "requests"])
        void cache.invalidateQueries({ queryKey: [key] });
    },
  });
  return (
    <BookDialog title={`Delete · ${asset.title}`} close={close}>
      {remove.isSuccess ? (
        <div className="add-missing" role="status">
          <p>{remove.data.message}.</p>
          {remove.data.held_path ? (
            <div className="delete-warning">
              <p>
                <strong>To recover this book</strong>
              </p>
              <ol>
                <li>
                  Move <code>{remove.data.held_path}</code>
                </li>
                <li>
                  back to <code>{remove.data.original_path}</code>
                </li>
                <li>Scan the library in Audiobookshelf.</li>
              </ol>
              <p className="muted">
                Paths are as Storyarr sees them.{" "}
                {days
                  ? `The files are deleted permanently after ${days} days.`
                  : "The files are kept until you delete them."}
              </p>
            </div>
          ) : (
            <p className="muted">
              The files were deleted and can’t be recovered.
            </p>
          )}
          {forget ? (
            <p className="muted">
              Blocked from future downloads: {remove.data.withdrawn_requests}{" "}
              requests withdrawn, {remove.data.excluded_from_lists} follow or
              Hardcover list entries excluded, {remove.data.removed_from_lists}{" "}
              automatic lists updated. To allow it again, include it in the
              follow (Following → Manage) or request it from its book page.
            </p>
          ) : (
            <p className="muted">
              Not blocked: your follows, lists and requests may download it
              again.
            </p>
          )}
          <button type="button" className="primary" onClick={close}>
            Done
          </button>
        </div>
      ) : (
        <form
          className="add-missing"
          onSubmit={(e) => {
            e.preventDefault();
            remove.mutate();
          }}
        >
          <Notice error={remove.error} />
          <div className="delete-warning" role="note">
            <p>
              <strong>This removes the book from Audiobookshelf</strong> (
              {asset.library_name}) and from your Storyarr library.
            </p>
          </div>
          <fieldset>
            <legend>Files</legend>
            <label className="check-label">
              <input
                type="radio"
                name="delete-files"
                checked={files === "hold"}
                onChange={() => setFiles("hold")}
              />
              Move to the holding folder
              {days ? ` (deleted after ${days} days)` : ""}
            </label>
            <label className="check-label">
              <input
                type="radio"
                name="delete-files"
                checked={files === "delete"}
                onChange={() => setFiles("delete")}
              />
              Delete permanently
            </label>
          </fieldset>
          <p className="muted">
            {files === "hold"
              ? `The files move to a hidden .deleted-books folder in the library${
                  days
                    ? ` and are deleted permanently after ${days} days`
                    : " and are kept until you delete them"
                }. Until then you can recover the book by moving the folder back; the steps are shown after deleting.`
              : "Audiobookshelf deletes the files from disk. This can’t be undone."}
          </p>
          {files === "delete" && (
            <label>
              Type DELETE to confirm
              <input
                value={typed}
                autoComplete="off"
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={forget}
              onChange={(e) => setForget(e.target.checked)}
            />
            Block this book from future downloads
          </label>
          <p className="muted">
            {forget
              ? "Withdraws your requests for it, excludes it from your follows and Hardcover lists, and removes it from your lists that download automatically, so automatic searches won’t download it again. You can allow it again later from the follow or the book page."
              : "Your follows, lists and requests may find and download it again."}
          </p>
          <div className="button-row">
            <button
              type="submit"
              className="primary"
              disabled={
                remove.isPending || (files === "delete" && typed !== "DELETE")
              }
            >
              {remove.isPending
                ? "Deleting…"
                : files === "hold"
                  ? "Move and remove"
                  : "Delete permanently"}
            </button>
            <button type="button" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </BookDialog>
  );
}

/** "Delete" in a book's action row: one Audiobookshelf copy opens the delete pop-up, several ask which. */
export function DeleteBookAction({ workId }: { workId: string }) {
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<Asset | null>(null);
  const copies = useQuery({
    queryKey: ["assets", workId, "deletable"],
    queryFn: async () =>
      result(
        await api.GET("/api/library/assets", {
          params: { query: { work_id: workId, limit: 40 } },
        }),
      ).items.filter(
        (asset) =>
          asset.server_kind === "audiobookshelf" &&
          !["intentionally-removed", "missing-confirmed"].includes(asset.state),
      ),
  });
  const items = copies.data || [];
  if (!items.length) return null;
  return (
    <>
      <button
        type="button"
        onClick={() =>
          items.length === 1 ? setChosen(items[0]) : setChoosing(true)
        }
      >
        Delete
      </button>
      {choosing && (
        <BookDialog
          title="Delete a library copy"
          close={() => setChoosing(false)}
        >
          <ul className="delete-copy-choices">
            {items.map((asset) => (
              <li key={asset.id}>
                <span>
                  <strong>{asset.title}</strong>
                  <span className="muted">
                    {" "}
                    · {asset.medium === "audio" ? "Audiobook" : "Ebook"} ·{" "}
                    {asset.library_name}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setChoosing(false);
                    setChosen(asset);
                  }}
                >
                  Delete this copy
                </button>
              </li>
            ))}
          </ul>
        </BookDialog>
      )}
      {chosen && (
        <DeleteLibraryCopy asset={chosen} close={() => setChosen(null)} />
      )}
    </>
  );
}
