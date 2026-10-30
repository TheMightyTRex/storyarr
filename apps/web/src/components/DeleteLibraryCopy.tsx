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
          {remove.data.held_path && (
            <p className="muted">
              Files are in <code>{remove.data.held_path}</code>
              {days ? ` for ${days} days.` : " until you delete them."}
            </p>
          )}
          {forget && (
            <p className="muted">
              {remove.data.withdrawn_requests} requests withdrawn ·{" "}
              {remove.data.excluded_from_lists} follow and list entries
              excluded.
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
          <p>Removes this copy from {asset.library_name} in Audiobookshelf.</p>
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
            Don’t download this book again
          </label>
          <p className="muted">
            {forget
              ? "Withdraws your requests for it and excludes it from your follows and lists."
              : "Follows and lists may find and download it again."}
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
