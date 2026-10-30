import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Loading, Notice } from "../components";
import BookDialog from "./BookDialog";
import FollowFilterFields from "./FollowFilterFields";
import { useFollowing } from "./FollowCatalog";
import { useAutomationSettings } from "../pages/AutomationSettings";
import { randomUUID } from "../randomUUID";

type Filters = components["schemas"]["FollowFilters"];
type Media = "audio" | "ebook" | "both";
type Preview = components["schemas"]["ActivationView"];
const mediaLabels: Record<Media, string> = {
  audio: "Audiobooks",
  ebook: "Ebooks",
  both: "Audiobooks and ebooks",
};

/** "Add missing books" for an author or series: one button and its pop-up. */
export default function AddMissingBooks({
  kind,
  externalId,
  name,
}: {
  kind: "author" | "series";
  externalId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="reader-action-link"
        onClick={() => setOpen(true)}
      >
        Add missing books
      </button>
      {open && (
        <BookDialog
          title={`Add missing books · ${name}`}
          close={() => setOpen(false)}
        >
          <AddMissingForm
            kind={kind}
            externalId={externalId}
            name={name}
            close={() => setOpen(false)}
          />
        </BookDialog>
      )}
    </>
  );
}

function AddMissingForm({
  kind,
  externalId,
  name,
  close,
}: {
  kind: "author" | "series";
  externalId: string;
  name: string;
  close: () => void;
}) {
  const cache = useQueryClient();
  const following = useFollowing();
  const automation = useAutomationSettings();
  const preferences = useQuery({
    queryKey: ["acquisition-preferences", "personal"],
    queryFn: async () =>
      result(
        await api.GET("/api/acquisition/preferences/{scope}", {
          params: { path: { scope: "personal" } },
        }),
      ),
  });
  const follow = following.data?.find(
    (f) => f.source_kind === kind && f.external_id === externalId,
  );
  const [chosenFilters, setFilters] = useState<Filters | null>(null);
  const [chosenMedia, setMedia] = useState<Media | null>(null);
  const [saveDefaults, setSaveDefaults] = useState(false);
  const [step, setStep] = useState("");
  const [preview, setPreview] = useState<{
    plan: Preview;
    listId: string;
  } | null>(null);
  const filters =
    chosenFilters ||
    follow?.filters ||
    automation.data?.settings.follow_filters;
  const preferred = preferences.data?.effective.desired_media;
  const media: Media =
    chosenMedia ||
    automation.data?.settings.missing_media ||
    (preferred === "ebook" || preferred === "both" ? preferred : "audio");

  async function waitForCatalog(listId: string) {
    for (let i = 0; i < 120; i++) {
      const all = result(await api.GET("/api/following"));
      const current = all.find((f) => f.list_id === listId);
      const state = current?.subscription.state;
      if (current && state !== "queued" && state !== "running") {
        if (state === "failed")
          throw new Error(
            current.subscription.message || "Catalog check failed",
          );
        return current;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("The catalog is still being checked. Try again shortly.");
  }

  const find = useMutation({
    mutationFn: async () => {
      if (!filters) throw new Error("Settings are still loading");
      let current = follow;
      if (!current) {
        setStep(`Following ${name}…`);
        current = result(
          await api.POST("/api/following", {
            body: {
              source_kind: kind,
              external_id: Number(externalId),
              name: name.slice(0, 200),
              filters,
            },
          }),
        );
      } else if (JSON.stringify(current.filters) !== JSON.stringify(filters)) {
        setStep("Saving book types…");
        current = result(
          await api.PATCH("/api/following/{list_id}", {
            params: { path: { list_id: current.list_id } },
            body: {
              expected_generation: current.subscription.generation,
              enabled: true,
              filters,
            },
          }),
        );
      }
      setStep("Checking the full catalog…");
      current = await waitForCatalog(current.list_id);
      setStep("Finding missing books…");
      const policy = result(
        await api.GET("/api/lists/{list_id}/acquisition", {
          params: { path: { list_id: current.list_id } },
        }),
      );
      if (saveDefaults && automation.data)
        result(
          await api.PUT("/api/automation/settings", {
            body: {
              follow_filters: filters,
              missing_media: media,
              expected_generation: automation.data.generation,
            },
          }),
        );
      const plan = result(
        await api.POST("/api/lists/{list_id}/acquisition/preview", {
          params: {
            path: { list_id: current.list_id },
            header: { "idempotency-key": randomUUID() },
          },
          body: {
            mode: "automatic",
            specification: { mode: media },
            include_missing: true,
            expected_revision: policy?.revision || 0,
          },
        }),
      );
      return { plan, listId: current.list_id };
    },
    onSuccess: (value) => setPreview(value),
    onSettled: () => {
      setStep("");
      void cache.invalidateQueries({ queryKey: ["following"] });
      void cache.invalidateQueries({ queryKey: ["automation-settings"] });
    },
  });

  const start = useMutation({
    mutationFn: async () =>
      result(
        await api.POST(
          "/api/lists/{list_id}/acquisition/previews/{identifier}/activate",
          {
            params: {
              path: {
                list_id: preview!.listId,
                identifier: preview!.plan.id,
              },
            },
          },
        ),
      ),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["following"] });
      void cache.invalidateQueries({ queryKey: ["list-policy"] });
    },
  });

  if (start.isSuccess)
    return (
      <div className="add-missing" role="status">
        <p>
          Searching for {preview?.plan.selected} missing{" "}
          {preview?.plan.selected === 1 ? "book" : "books"}. Each book’s status
          shows its progress, and books that aren’t found are searched again
          later.
        </p>
        <button type="button" className="primary" onClick={close}>
          Done
        </button>
      </div>
    );
  if (preview) {
    const plan = preview.plan;
    return (
      <div className="add-missing">
        <Notice error={start.error} />
        <p>
          <strong>{plan.selected}</strong> missing{" "}
          {plan.selected === 1 ? "book" : "books"} will be searched for
          automatically as {mediaLabels[media].toLowerCase()}.
        </p>
        <p className="muted">
          {plan.counts?.owned || 0} already in your library ·{" "}
          {plan.counts?.excluded || 0} left out by book type or by you. Future
          books are added automatically too.
        </p>
        <div className="button-row">
          <button
            type="button"
            className="primary"
            disabled={start.isPending || !plan.selected}
            onClick={() => start.mutate()}
          >
            {start.isPending ? "Starting…" : "Start searching"}
          </button>
          <button type="button" onClick={() => setPreview(null)}>
            Back
          </button>
        </div>
      </div>
    );
  }
  if (following.isPending || automation.isPending || preferences.isPending)
    return <Loading />;
  return (
    <form
      className="add-missing"
      onSubmit={(e) => {
        e.preventDefault();
        find.mutate();
      }}
    >
      <Notice error={find.error || following.error || automation.error} />
      <fieldset>
        <legend>Media</legend>
        {(Object.keys(mediaLabels) as Media[]).map((value) => (
          <label className="check-label" key={value}>
            <input
              type="radio"
              name="missing-media"
              checked={media === value}
              onChange={() => setMedia(value)}
            />
            {mediaLabels[value]}
          </label>
        ))}
      </fieldset>
      {filters && <FollowFilterFields value={filters} change={setFilters} />}
      <label className="check-label">
        <input
          type="checkbox"
          checked={saveDefaults}
          onChange={(e) => setSaveDefaults(e.target.checked)}
        />
        Save these as my defaults
      </label>
      <p className="muted">
        {follow
          ? "Changing book types updates this follow."
          : `This follows ${name}, so new books are added automatically too.`}{" "}
        Downloads use your{" "}
        <Link to="/settings#preferences">download preferences</Link>.
      </p>
      {step && <p role="status">{step}</p>}
      <button
        type="submit"
        className="primary"
        disabled={find.isPending || !filters}
      >
        {find.isPending ? "Working…" : "Find missing books"}
      </button>
    </form>
  );
}
