import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Loading, Notice } from "../components";
import SettingHelp from "./SettingHelp";
import SavedNote from "./SavedNote";
import { useToast } from "./Toasts";

type Setup = components["schemas"]["RadioLibrarySetup"];
type Current = components["schemas"]["RadioLibraryView"];

/** One choice per podcast library folder: "Radio · Home server: /radio". */
function choices(setup: Setup) {
  return (setup.options ?? []).flatMap((library) =>
    library.folders.map((folder) => ({
      key: `${library.integration_id}|${library.library_id}|${folder}`,
      label: `${library.name} · ${library.server_name}: ${folder}`,
      integration_id: library.integration_id,
      library_id: library.library_id,
      folder,
    })),
  );
}

function when(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function count(value: number, one: string, many: string) {
  return `${value} ${value === 1 ? one : many}`;
}

/**
 * Settings, Connections: the Audiobookshelf podcast library radio is filed into (FEAT-R, R3).
 * Storyarr reads it every 15 minutes and marks the episodes it holds as in your library.
 */
export default function RadioLibrarySetting() {
  const cache = useQueryClient();
  const setup = useQuery({
    queryKey: ["radio-library"],
    queryFn: async () => result(await api.GET("/api/radio/library")),
  });
  const [changing, setChanging] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const toast = useToast();
  const sync = useMutation({
    mutationFn: async () => result(await api.POST("/api/radio/library/sync")),
    onSuccess: () =>
      toast("Reading the radio library", {
        tone: "info",
        detail: "This takes a minute.",
      }),
  });
  const current = setup.data?.current;
  return (
    <section className="settings-block" aria-label="Radio library">
      <div className="setting-subheading">
        <h3>Radio library</h3>
        <SettingHelp label="the radio library">
          Radio episodes are filed into an Audiobookshelf podcast library, one
          folder per show, named like Show - S20E03 - Title. Storyarr reads the
          library every 15 minutes and shows the episodes it holds as in your
          library. Make a podcast library in Audiobookshelf for radio first.
        </SettingHelp>
      </div>
      <Notice error={setup.error || sync.error} />
      {setup.isPending ? (
        <Loading />
      ) : setup.data && (changing || !current) ? (
        <RadioLibraryForm
          setup={setup.data}
          current={current ?? null}
          onCancel={current ? () => setChanging(false) : undefined}
          onSaved={(saved) => {
            cache.setQueryData<Setup>(["radio-library"], (old) =>
              old ? { ...old, current: saved } : old,
            );
            setChanging(false);
            setSavedAt(new Date());
          }}
        />
      ) : current ? (
        <>
          <dl className="library-folder-paths">
            <div>
              <dt>Library</dt>
              <dd>
                {current.name} on {current.server_name}
              </dd>
            </div>
            <div>
              <dt>Folder in Audiobookshelf</dt>
              <dd>
                <code>{current.abs_folder}</code>
              </dd>
            </div>
            <div>
              <dt>Same folder for Storyarr</dt>
              <dd>
                <code>{current.local_path}</code>
              </dd>
            </div>
            <div>
              <dt>Last read</dt>
              <dd>
                {current.synced_at ? when(current.synced_at) : "Not read yet"}
              </dd>
            </div>
            <div>
              <dt>Episodes</dt>
              <dd>
                {count(current.files, "episode file", "episode files")},{" "}
                {count(current.linked, "matched", "matched")} to your shows
              </dd>
            </div>
          </dl>
          {current.last_error && (
            <p className="notice error" role="alert">
              The last read did not finish: {current.last_error}
            </p>
          )}
          <div className="button-row">
            <button
              type="button"
              disabled={sync.isPending}
              onClick={() => {
                setSavedAt(null);
                sync.mutate();
              }}
            >
              Read again
            </button>
            <button
              type="button"
              onClick={() => {
                setSavedAt(null);
                setChanging(true);
              }}
            >
              Change
            </button>
            <SavedNote at={savedAt} detail="Storyarr is reading it now." />
          </div>
        </>
      ) : null}
    </section>
  );
}

function RadioLibraryForm({
  setup,
  current,
  onCancel,
  onSaved,
}: {
  setup: Setup;
  current: Current | null;
  onCancel?: () => void;
  onSaved: (saved: Current) => void;
}) {
  const options = choices(setup);
  const initial =
    options.find(
      (option) =>
        current &&
        option.integration_id === current.integration_id &&
        option.library_id === current.library_id &&
        option.folder === current.abs_folder,
    ) ?? options[0];
  const [choice, setChoice] = useState(initial?.key ?? "");
  const [localPath, setLocalPath] = useState(
    current?.local_path ?? initial?.folder ?? "",
  );
  const chosen = options.find((option) => option.key === choice);
  const save = useMutation({
    mutationFn: async () =>
      result(
        await api.PUT("/api/radio/library", {
          body: {
            integration_id: chosen!.integration_id,
            library_id: chosen!.library_id,
            abs_folder: chosen!.folder,
            local_path: localPath.trim(),
          },
        }),
      ),
    onSuccess: onSaved,
  });
  return (
    <form
      className="editor"
      aria-label="Choose the radio library"
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen && localPath.trim()) save.mutate();
      }}
    >
      {(setup.errors ?? []).map((error) => (
        <p className="notice error" role="alert" key={error}>
          {error}
        </p>
      ))}
      {options.length ? (
        <>
          <label className="library-selection">
            Podcast library and folder
            <select
              value={choice}
              onChange={(event) => {
                const next = options.find(
                  (option) => option.key === event.target.value,
                );
                setChoice(event.target.value);
                if (next) setLocalPath(next.folder);
              }}
            >
              {options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Same folder for Storyarr
            <input
              value={localPath}
              onChange={(event) => setLocalPath(event.target.value)}
              spellCheck={false}
              aria-describedby="radio-library-path-hint"
            />
          </label>
          <p className="muted small" id="radio-library-path-hint">
            Where this folder is mounted for Storyarr. It is often the same
            path.
          </p>
          <Notice error={save.error} />
          <div className="button-row">
            <button
              type="submit"
              className="primary"
              disabled={save.isPending || !chosen || !localPath.trim()}
            >
              {save.isPending ? "Saving" : "Save radio library"}
            </button>
            {onCancel && (
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="muted">
          No podcast libraries yet. In Audiobookshelf, add a library of the
          Podcasts type for radio, then come back here.
        </p>
      )}
    </form>
  );
}
