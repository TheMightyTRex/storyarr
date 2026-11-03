import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Empty, Loading, Notice } from "../components";
import { AddShow } from "./Radio";

type Review = components["schemas"]["RadioLibraryReview"];
type LibraryShow = components["schemas"]["RadioLibraryShow"];
type UnmatchedShow = components["schemas"]["RadioUnmatchedShow"];
type UnmatchedFile = components["schemas"]["RadioUnmatchedFile"];

const base = "/library/radio";
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export function useRadioReview(enabled = true) {
  return useQuery({
    queryKey: ["radio", "review"],
    enabled,
    queryFn: async ({ signal }) =>
      result(await api.GET("/api/radio/library/review", { signal })),
  });
}

/** The line on Radio that leads here, when the radio library holds something to look at. */
export function RadioReviewNotice({ review }: { review?: Review }) {
  const shows = review?.shows?.length ?? 0;
  const files = review?.unmatched_files ?? 0;
  if (!shows && !files) return null;
  const parts = [
    shows && `${plural(shows, "show")} not in your radio shows`,
    files && `${plural(files, "file")} that match no episode`,
  ].filter(Boolean);
  return (
    <p className="notice radio-review-notice">
      Your radio library has {parts.join(" and ")}.{" "}
      <Link to={`${base}/review`}>Review the radio library</Link>
    </p>
  );
}

/**
 * Review the radio library (RADIO-03): add the shows it holds that are not in your radio shows,
 * and choose the episode for files that matched none.
 */
export default function RadioReview({ canEdit }: { canEdit: boolean }) {
  const review = useRadioReview();
  const data = review.data;
  return (
    <section className="radio-review" aria-labelledby="radio-review-title">
      <Link className="back-link" to={base}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to Radio
      </Link>
      <h1 id="radio-review-title">Review the radio library</h1>
      <p className="muted">
        {data?.library
          ? `What the ${data.library} library in Audiobookshelf holds that your radio shows do not cover yet.`
          : "What the radio library holds that your radio shows do not cover yet."}
      </p>
      <Notice error={review.error} />
      {review.isPending && <Loading />}
      {data && !data.library && (
        <Empty title="No radio library chosen">
          An admin chooses the radio library in Settings, Connections.
        </Empty>
      )}
      {data?.library && (
        <>
          <ShowsToAdd shows={data.shows} canEdit={canEdit} />
          <UnmatchedFiles shows={data.unmatched} canEdit={canEdit} />
        </>
      )}
    </section>
  );
}

function ShowsToAdd({
  shows,
  canEdit,
}: {
  shows: LibraryShow[];
  canEdit: boolean;
}) {
  const cache = useQueryClient();
  const [adding, setAdding] = useState<LibraryShow | null>(null);
  const [message, setMessage] = useState("");
  return (
    <section
      className="radio-review-section"
      aria-labelledby="radio-review-shows"
    >
      <h2 id="radio-review-shows" className="radio-section-title">
        Shows to add
      </h2>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {shows.length ? (
        <>
          <p className="muted">
            These shows are in the radio library but not in your radio shows.
            Find each one on the BBC to add it. Its files then show as in your
            library.
          </p>
          <ul className="radio-review-list">
            {shows.map((show) => (
              <li key={show.item_id} className="radio-review-row">
                <span>
                  <strong>{show.title}</strong>
                  <span className="small muted">
                    {" "}
                    · {plural(show.files, "file")}
                  </span>
                </span>
                {canEdit && (
                  <span className="button-row">
                    <button
                      type="button"
                      aria-label={`Find on the BBC: ${show.title}`}
                      onClick={() => {
                        setMessage("");
                        setAdding(show);
                      }}
                    >
                      Find on the BBC
                    </button>
                    <UseForShow show={show} onDone={setMessage} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">
          Every show in the radio library is in your radio shows.
        </p>
      )}
      {adding && (
        <AddShow
          close={() => setAdding(null)}
          initialText={adding.title}
          libraryItemId={adding.item_id}
          onAdded={(added) => {
            setAdding(null);
            setMessage(
              `${added.title} added. Storyarr is reading its series from the BBC, then its files show as in your library.`,
            );
            void cache.invalidateQueries({ queryKey: ["radio"] });
          }}
        />
      )}
    </section>
  );
}

/** For a show already added under another name: use this library show's files for it. */
function UseForShow({
  show,
  onDone,
}: {
  show: LibraryShow;
  onDone: (message: string) => void;
}) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const shows = useQuery({
    queryKey: ["radio", "shows", {}],
    enabled: open,
    queryFn: async ({ signal }) =>
      result(await api.GET("/api/radio/shows", { signal })),
  });
  const use = useMutation({
    mutationFn: async () =>
      result(
        await api.PATCH("/api/radio/shows/{show_id}", {
          params: { path: { show_id: choice } },
          body: { library_item_id: show.item_id },
        }),
      ),
    onSuccess: async (saved) => {
      setOpen(false);
      onDone(`${show.title} files now belong to ${saved.title}.`);
      await cache.invalidateQueries({ queryKey: ["radio"] });
    },
  });
  if (!open)
    return (
      <button
        type="button"
        aria-label={`Already added: ${show.title}`}
        onClick={() => setOpen(true)}
      >
        Already added
      </button>
    );
  const id = `radio-use-${show.item_id}`;
  return (
    <form
      className="radio-review-use"
      onSubmit={(event) => {
        event.preventDefault();
        if (choice) use.mutate();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Your show for {show.title}
      </label>
      <select
        id={id}
        value={choice}
        onChange={(event) => setChoice(event.target.value)}
      >
        <option value="">Choose your show</option>
        {(shows.data?.items ?? []).map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!choice || use.isPending}>
        Use these files
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <Notice error={use.error || shows.error} />
    </form>
  );
}

function UnmatchedFiles({
  shows,
  canEdit,
}: {
  shows: UnmatchedShow[];
  canEdit: boolean;
}) {
  const count = shows.reduce((n, show) => n + show.files.length, 0);
  return (
    <section
      className="radio-review-section"
      aria-labelledby="radio-review-files"
    >
      <h2 id="radio-review-files" className="radio-section-title">
        Files that match no episode
      </h2>
      {count ? (
        <>
          <p className="muted">
            Storyarr matches a file by its BBC programme id, then by series and
            episode number, then by title. These {plural(count, "file")} matched
            none, often because the BBC numbers repeats as series of their own.
            Choose the episode each file holds.
          </p>
          {shows.map((show) => (
            <ShowFiles key={show.show_id} show={show} canEdit={canEdit} />
          ))}
        </>
      ) : (
        <p className="muted">Every file of your shows holds an episode.</p>
      )}
    </section>
  );
}

function ShowFiles({
  show,
  canEdit,
}: {
  show: UnmatchedShow;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["radio", "show", show.show_id],
    enabled: open && canEdit,
    queryFn: async ({ signal }) =>
      result(
        await api.GET("/api/radio/shows/{show_id}", {
          params: { path: { show_id: show.show_id } },
          signal,
        }),
      ),
  });
  const episodes = (detail.data?.series ?? []).flatMap((series) =>
    series.episodes.map((episode) => ({
      id: episode.id,
      label:
        (series.kind === "specials"
          ? `Specials, episode ${episode.number}`
          : `Series ${series.number}, episode ${episode.number}`) +
        (episode.title && !/^Episode \d+$/.test(episode.title)
          ? `: ${episode.title}`
          : "") +
        (episode.status.kind === "in_library" ? " (has a file)" : ""),
    })),
  );
  return (
    <details
      className="radio-review-show"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <strong>{show.title}</strong>
        <span className="small muted">
          {" "}
          · {plural(show.files.length, "file")}
        </span>
      </summary>
      <Notice error={detail.error} />
      {open && canEdit && detail.isPending && <Loading />}
      <ul className="radio-review-list">
        {show.files.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            episodes={episodes}
            canEdit={canEdit && !!detail.data}
          />
        ))}
      </ul>
      <p className="small">
        <Link to={`${base}/shows/${show.show_id}`}>Go to {show.title}</Link>
      </p>
    </details>
  );
}

function FileRow({
  file,
  episodes,
  canEdit,
}: {
  file: UnmatchedFile;
  episodes: { id: string; label: string }[];
  canEdit: boolean;
}) {
  const cache = useQueryClient();
  const [choice, setChoice] = useState("");
  const link = useMutation({
    mutationFn: async () =>
      result(
        await api.PUT("/api/radio/episodes/{episode_id}/file", {
          params: { path: { episode_id: choice } },
          body: { file_id: file.id },
        }),
      ),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["radio"] }),
  });
  const id = `radio-file-${file.id}`;
  return (
    <li className="radio-review-row radio-review-file">
      <span>
        <span className="radio-review-name">{file.name}</span>
        {file.title && file.title !== file.name && (
          <span className="small muted"> · {file.title}</span>
        )}
      </span>
      {canEdit && (
        <form
          className="radio-review-use"
          onSubmit={(event) => {
            event.preventDefault();
            if (choice) link.mutate();
          }}
        >
          <label htmlFor={id} className="sr-only">
            Episode in {file.name}
          </label>
          <select
            id={id}
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">Choose the episode</option>
            {episodes.map((episode) => (
              <option key={episode.id} value={episode.id}>
                {episode.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            aria-label={`Link ${file.name}`}
            disabled={!choice || link.isPending}
          >
            Link
          </button>
          <Notice error={link.error} />
        </form>
      )}
    </li>
  );
}
