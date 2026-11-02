import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Download } from "lucide-react";
import { Link } from "react-router-dom";
import { api, result, type Auth } from "../api/client";
import { canStartDownload } from "../permissions";
import { Notice } from "../components";
import { randomUUID } from "../randomUUID";
import QuickAddStatus from "./QuickAddStatus";

export type Mode = "both" | "ebook" | "audio" | undefined;
const MISSING_MEDIA = "Choose media to request or set a default";

function PreferencePrompt() {
  const hint = useId();
  return (
    <div className="quick-add-preference">
      <p id={hint}>Preference not set</p>
      <Link
        className="button-link"
        to="/settings#preferences"
        aria-describedby={hint}
      >
        Set here
      </Link>
    </div>
  );
}
/**
 * Quick add's logic, shared by the Quick add button and the cover actions: the person's saved format
 * choices, the request, and its progress. `engaged` turns the queries on (a cover only asks once the
 * pointer or focus reaches it).
 */
export function useQuickAdd({
  workId,
  resolveWork,
  engaged,
  cover = false,
}: {
  workId?: string;
  resolveWork?: () => Promise<string>;
  engaged: boolean;
  cover?: boolean;
}) {
  const cache = useQueryClient();
  const { data: session } = useQuery<Auth | null>({
    queryKey: ["session"],
    enabled: false,
  });
  const grants = session?.user.permissions;
  const role = session?.user.role;
  const ebookDownload = canStartDownload(grants, role, "ebook");
  const audioDownload = canStartDownload(grants, role, "audio");
  const eitherDownload = canStartDownload(grants, role);
  const [resolvedId, setResolvedId] = useState(workId);
  const id = workId || resolvedId;
  const command = useRef({ mode: undefined as Mode, key: randomUUID() });
  const defaults = useQuery({
    queryKey: ["quick-add-defaults"],
    queryFn: async () =>
      result(
        await api.GET("/api/acquisition/preferences/{scope}", {
          params: { path: { scope: "personal" } },
        }),
      ),
    enabled: engaged,
    staleTime: cover ? 60_000 : 0,
  });
  const status = useQuery({
    queryKey: ["quick-add", id],
    enabled: !!id && engaged,
    queryFn: async () =>
      result(
        await api.GET("/api/requests/quick-add/latest/{work_id}", {
          params: { path: { work_id: id! } },
        }),
      ),
    refetchInterval: (query) => {
      const receipt = query.state.data;
      if (!receipt) return false;
      if (["queued", "running"].includes(receipt.status)) return 1500;
      // A completed Quick Add has only queued the download. Keep checking until
      // inventory confirms the requested files and the API retires the banner.
      return receipt.status === "completed" && receipt.request_id
        ? 5000
        : false;
    },
  });
  const add = useMutation({
    mutationFn: async (mode: Mode) => {
      if (command.current.mode !== mode)
        command.current = { mode, key: randomUUID() };
      const work = id || (await resolveWork!());
      setResolvedId(work);
      const receipt = result(
        await api.POST("/api/requests/quick-add", {
          params: { header: { "idempotency-key": command.current.key } },
          body: { work_id: work, specification: mode ? { mode } : {} },
        }),
      );
      await cache.cancelQueries({ queryKey: ["quick-add", work] });
      cache.setQueryData(["quick-add", work], receipt);
      return receipt;
    },
    onSuccess: () => {
      command.current.key = randomUUID();
      for (const name of ["requests", "activity", "downloads"])
        void cache.invalidateQueries({ queryKey: [name] });
    },
  });
  const busy =
    add.isPending ||
    !!(status.data && ["queued", "running"].includes(status.data.status));
  useEffect(() => {
    if (status.data && !["queued", "running"].includes(status.data.status)) {
      for (const name of ["requests", "activity", "downloads", "book-sources"])
        void cache.invalidateQueries({ queryKey: [name] });
    }
  }, [cache, status.data?.id, status.data?.status]);
  const preference = defaults.data?.effective?.desired_media;
  const preferenceUnset = defaults.isSuccess && preference == null;
  const [needsPreference, setNeedsPreference] = useState(false);
  const preferenceError = add.error?.message === MISSING_MEDIA;
  const missingPreference =
    (needsPreference || preferenceError) &&
    (preferenceUnset || !defaults.isSuccess);
  const feedbackError = add.isPending
    ? null
    : (preferenceError ? null : add.error) || status.error || null;
  const starting = add.isPending
    ? add.variables === "audio"
      ? "Starting audiobook request…"
      : add.variables === "ebook"
        ? "Starting ebook request…"
        : add.variables === "both"
          ? "Starting ebook and audiobook request…"
          : "Starting your request…"
    : undefined;
  const coverStatus = starting
    ? "Starting…"
    : feedbackError
      ? "Retry needed"
      : status.data?.status === "completed"
        ? status.data.message.startsWith("Already available")
          ? "In library"
          : "Queued"
        : status.data?.status === "held"
          ? "Needs attention"
          : status.data?.status === "failed"
            ? "Failed"
            : status.data?.status === "cancelled"
              ? "Cancelled"
              : "Searching…";
  const coverNeedsReview =
    !!status.data && ["held", "failed"].includes(status.data.status);
  const label =
    preference === "audio"
      ? "Audiobook"
      : preference === "ebook"
        ? "Ebook"
        : preference === "both"
          ? "Ebook + audiobook"
          : preference === "either"
            ? "Either format"
            : "Saved preferences";
  function choose(mode: Mode) {
    if (
      mode == null &&
      (preferenceUnset || (!defaults.isSuccess && preferenceError))
    ) {
      setNeedsPreference(true);
      return;
    }
    setNeedsPreference(false);
    add.mutate(mode);
  }
  return {
    id,
    busy,
    addFailed: !!add.error && !add.isPending,
    choose,
    starting,
    feedbackError,
    missingPreference,
    coverStatus,
    coverNeedsReview,
    status,
    label,
    preferenceUnset,
    ebookDownload,
    audioDownload,
    eitherDownload,
  };
}

export default function QuickAdd({
  workId,
  resolveWork,
  actionLabel = "Quick add",
}: {
  workId?: string;
  resolveWork?: () => Promise<string>;
  actionLabel?: string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const quick = useQuickAdd({ workId, resolveWork, engaged: true });
  const {
    id,
    busy,
    starting,
    feedbackError,
    missingPreference,
    status,
    label,
    preferenceUnset,
    ebookDownload,
    audioDownload,
    eitherDownload,
  } = quick;
  function choose(mode: Mode) {
    if (menu.current) menu.current.open = false;
    quick.choose(mode);
  }
  if (!ebookDownload && !audioDownload) return null;
  return (
    <div className="quick-add">
      <div className="quick-add-split">
        <button
          className="primary"
          disabled={busy || !eitherDownload}
          onClick={() => choose(undefined)}
          title={
            !eitherDownload
              ? "Choose a format you can download"
              : preferenceUnset
                ? "Quick add preference not set"
                : actionLabel === "Quick add"
                  ? `Quick add · ${label}. Uses your saved format priorities.`
                  : `${actionLabel} · ${label}. Looks for a file today using your saved format priorities.`
          }
        >
          <Download size={16} />
          {busy
            ? "Adding…"
            : actionLabel === "Quick add"
              ? `Quick add · ${label}`
              : actionLabel}
        </button>
        <details
          ref={menu}
          className="quick-add-menu"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              event.currentTarget.open = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary aria-label={`${actionLabel} format`} title="Choose a format">
            <ChevronDown size={16} />
          </summary>
          <div className="quick-add-options">
            <button
              disabled={busy || !eitherDownload}
              onClick={() => choose("both")}
            >
              Both
            </button>
            <button
              disabled={busy || !ebookDownload}
              onClick={() => choose("ebook")}
            >
              Ebook
            </button>
            <button
              disabled={busy || !audioDownload}
              onClick={() => choose("audio")}
            >
              Audiobook
            </button>
            <small>Uses your saved format priorities.</small>
          </div>
        </details>
      </div>
      {missingPreference ? (
        <PreferencePrompt />
      ) : (
        <>
          <Notice error={feedbackError} />
          {quick.addFailed && (
            <Link to="/settings#preferences">Download preferences</Link>
          )}
        </>
      )}
      {(starting || status.data) && !missingPreference && (
        <QuickAddStatus
          receipt={status.data || undefined}
          workId={id}
          starting={starting}
        />
      )}
    </div>
  );
}
