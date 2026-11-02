import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { BookOpen, Globe, HardDrive, Image, Upload } from "lucide-react";
import type { components } from "../api/schema";
import { api, ApiError, result } from "../api/client";
import { Notice } from "../components";
import SidePanel from "./SidePanel";
import LogoMask from "./LogoMask";
import LogoEditor, { type EditorSource } from "./LogoEditor";
import { START_BOX, WHOLE } from "../logoCutout";

export type Logo = components["schemas"]["LogoView"];
type Colour = "text" | "accent";
type CommonsResult = components["schemas"]["CommonsResult"];
/** Whose logo: a series (shared by everyone, admins change it) or a radio show (its owner). */
export type LogoTarget =
  { kind: "series"; externalId: string } | { kind: "show"; showId: string };
/** A cover (or a show's artwork) the logo can be cut from, served by Storyarr itself. */
export type LogoCover = { label: string; title: string; url: string };
/** The edited logo, waiting for Save logo: always a PNG from the logo editor, shown from a data: address. */
type Pending = {
  blob: Blob;
  url: string;
  source: "upload" | "cover" | "commons";
  title: string;
  label: string;
};

const MAX_BYTES = 1024 * 1024;

/** What the saved copy is, in words: "From the cover of Space Team, book 1". */
export function logoSource(logo: Logo) {
  if (logo.source === "commons")
    return `From Wikimedia Commons: ${logo.source_title || "a file"}${logo.licence ? `. Licence: ${logo.licence}` : ""}`;
  if (logo.source === "cover")
    return logo.source_title ? `From ${logo.source_title}` : "Cut from a cover";
  return logo.source_title ? `Uploaded: ${logo.source_title}` : "Uploaded";
}

async function upload(
  target: LogoTarget,
  blob: Blob,
  query: {
    source: "upload" | "cover" | "commons";
    title: string;
    colour: Colour;
  },
) {
  const options = {
    body: blob as unknown as string,
    bodySerializer: (body: unknown) => body as Blob,
    headers: { "Content-Type": blob.type || "application/octet-stream" },
  };
  return target.kind === "series"
    ? result(
        await api.PUT("/api/catalog/series/hardcover/{external_id}/logo", {
          ...options,
          params: { path: { external_id: target.externalId }, query },
        }),
      )
    : result(
        await api.PUT("/api/radio/shows/{show_id}/logo", {
          ...options,
          params: { path: { show_id: target.showId }, query },
        }),
      );
}

async function recolour(target: LogoTarget, colour: Colour) {
  return target.kind === "series"
    ? result(
        await api.PATCH("/api/catalog/series/hardcover/{external_id}/logo", {
          params: { path: { external_id: target.externalId } },
          body: { colour },
        }),
      )
    : result(
        await api.PATCH("/api/radio/shows/{show_id}/logo", {
          params: { path: { show_id: target.showId } },
          body: { colour },
        }),
      );
}

async function remove(target: LogoTarget) {
  const answer =
    target.kind === "series"
      ? await api.DELETE("/api/catalog/series/hardcover/{external_id}/logo", {
          params: { path: { external_id: target.externalId } },
        })
      : await api.DELETE("/api/radio/shows/{show_id}/logo", {
          params: { path: { show_id: target.showId } },
        });
  if (!answer.response.ok)
    throw new ApiError("The logo could not be removed. Try again.", 0);
}

/**
 * The Change logo slide-out (UX-43): the saved copy and Remove, then three ways to get a logo (from a
 * cover, Wikimedia Commons, upload), the colour and a light and dark preview. Save uploads the result.
 */
export default function LogoPanel({
  target,
  name,
  people,
  logo,
  covers,
  onClose,
  onChanged,
}: {
  target: LogoTarget;
  /** The series or show name. */
  name: string;
  /** Authors (or presenters): a Commons file that mentions none of them is a probable wrong match. */
  people: string[];
  logo: Logo | null | undefined;
  covers: LogoCover[];
  onClose: () => void;
  /** After a save or a removal, with words for the page's status message. */
  onChanged: (message: string) => void;
}) {
  const id = useId();
  const show = target.kind === "show";
  const noun = show ? "show" : "series";
  const [tab, setTab] = useState<"cover" | "find" | "upload">(
    covers.length ? "cover" : "find",
  );
  const [pending, setPending] = useState<Pending | null>(null);
  const [colour, setColour] = useState<Colour>(
    (logo?.colour as Colour) || "text",
  );
  const [saved, setSaved] = useState(logo ?? null);
  const savedNone = useRef<HTMLParagraphElement>(null);
  // After Remove, focus moves to "No logo saved" once it is on the page (the Remove button is gone).
  const [focusNone, setFocusNone] = useState(false);
  useEffect(() => {
    if (focusNone && !saved && savedNone.current) {
      savedNone.current.focus();
      setFocusNone(false);
    }
  }, [focusNone, saved]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // What the editor works on in Upload your own and Find online.
  const [uploaded, setUploaded] = useState<EditorSource | null>(null);
  const [found, setFound] = useState<EditorSource | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      // Commons files keep their licence: the server reads it from Commons for the title.
      if (pending)
        return upload(target, pending.blob, {
          source: pending.source,
          title: pending.title,
          colour,
        });
      if (saved && colour !== saved.colour) return recolour(target, colour);
      return saved;
    },
    onSuccess: (view) => {
      onChanged(
        view
          ? `Logo saved on this server at ${view.saved_path}.`
          : "Nothing changed.",
      );
      onClose();
    },
  });
  const removal = useMutation({
    mutationFn: () => remove(target),
    onSuccess: () => {
      setSaved(null);
      setPending(null);
      onChanged(`Logo removed. The ${noun} name is shown as a wordmark.`);
      setFocusNone(true);
    },
  });

  const tabs = [
    {
      key: "cover" as const,
      label: show ? "From the artwork" : "From a cover",
      icon: show ? Image : BookOpen,
    },
    { key: "find" as const, label: "Find online", icon: Globe },
    { key: "upload" as const, label: "Upload your own", icon: Upload },
  ];
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const go = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (go === undefined) return;
    event.preventDefault();
    const next = (go + tabs.length) % tabs.length;
    setTab(tabs[next].key);
    tabRefs.current[next]?.focus();
  }

  const preview = pending?.url
    ? { url: pending.url, label: pending.label }
    : saved
      ? { url: saved.url, label: "the saved logo" }
      : null;
  const changed = !!pending || (!!saved && colour !== saved.colour);

  return (
    <SidePanel
      title={show ? "Show logo" : "Series logo"}
      closeLabel={show ? "Close show logo" : "Close series logo"}
      wide
      className="logo-panel"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!changed || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save logo"}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <section className="logo-saved" aria-labelledby={`${id}-saved`}>
        <h3 id={`${id}-saved`}>
          <HardDrive size={18} aria-hidden="true" />
          Saved logo
        </h3>
        {saved ? (
          <div className="logo-saved__row">
            <LogoMask
              url={saved.url}
              label={`Saved logo for ${name}`}
              colour={saved.colour as Colour}
            />
            <div className="logo-saved__text">
              <span>
                Saved on this server at <code>{saved.saved_path}</code>
              </span>
              <span className="muted">{logoSource(saved)}</span>
              {saved.source === "commons" && saved.source_url && (
                <a href={saved.source_url} target="_blank" rel="noreferrer">
                  File page on Wikimedia Commons (opens in a new tab)
                </a>
              )}
              <span className="muted">
                Storyarr keeps this copy in its config folder, so the logo is
                never fetched again and works offline.
              </span>
              <div className="series-head__actions">
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={removal.isPending}
                  onClick={() => removal.mutate()}
                >
                  Remove logo
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className="muted" ref={savedNone} tabIndex={-1}>
            No logo saved. The {noun} name is shown as a wordmark.
          </p>
        )}
        <Notice error={removal.error} />
      </section>

      <div className="logo-tabs" role="tablist" aria-label="Ways to get a logo">
        {tabs.map((item, index) => (
          <button
            key={item.key}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${item.key}`}
            aria-controls={`${id}-pane-${item.key}`}
            aria-selected={tab === item.key}
            tabIndex={tab === item.key ? 0 : -1}
            onClick={() => setTab(item.key)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            <item.icon size={18} aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>

      {tabs.map((item) => (
        <div
          key={item.key}
          className="logo-pane"
          role="tabpanel"
          id={`${id}-pane-${item.key}`}
          aria-labelledby={`${id}-tab-${item.key}`}
          tabIndex={0}
          hidden={tab !== item.key}
        >
          {item.key === "cover" &&
            tab === "cover" &&
            (covers.length ? (
              <LogoEditor
                sources={covers}
                chooseLegend={show ? undefined : "Choose a cover"}
                startBox={START_BOX}
                picture={show ? "picture" : "cover"}
                describe={(cover) => ({
                  title: (show
                    ? "the artwork"
                    : `the cover of ${cover.title}${cover.label ? `, ${cover.label.toLowerCase()}` : ""}`
                  ).slice(0, 300),
                  label: show
                    ? "cut from the artwork"
                    : `cut from ${cover.label.toLowerCase()}`,
                })}
                onCut={(cut) => setPending({ ...cut, source: "cover" })}
              />
            ) : (
              <p className="muted">
                {show
                  ? "This show has no artwork saved. Upload a logo instead."
                  : "This series has no covers yet. Upload a logo instead."}
              </p>
            ))}
          {item.key === "find" && (
            <>
              <FindOnline
                name={name}
                people={people}
                noun={noun}
                chosen={found?.title ?? null}
                onChoose={(item) =>
                  setFound({
                    label: item.title,
                    title: item.title,
                    // Read through Storyarr, so the editor can show and change it.
                    url: `/api/logos/commons/file?title=${encodeURIComponent(item.title)}`,
                  })
                }
              />
              {found && tab === "find" && (
                <LogoEditor
                  key={found.url}
                  sources={[found]}
                  startBox={WHOLE}
                  picture="file"
                  describe={(file) => ({
                    title: file.title,
                    label: `${file.title}, from Wikimedia Commons`,
                  })}
                  onCut={(cut) => setPending({ ...cut, source: "commons" })}
                />
              )}
            </>
          )}
          {item.key === "upload" && (
            <>
              <UploadOwn onFile={setUploaded} />
              {uploaded && tab === "upload" && (
                <LogoEditor
                  key={uploaded.url}
                  sources={[uploaded]}
                  startBox={WHOLE}
                  picture="file"
                  describe={(file) => ({
                    title: file.title,
                    label: file.label,
                  })}
                  onCut={(cut) => setPending({ ...cut, source: "upload" })}
                />
              )}
            </>
          )}
        </div>
      ))}

      <fieldset className="field">
        <legend>Colour</legend>
        <div className="segmented">
          {(
            [
              ["text", "Text colour"],
              ["accent", "Accent colour"],
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name={`${id}-colour`}
                value={value}
                checked={colour === value}
                onChange={() => setColour(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <span className="field__label">
          <strong>Preview</strong>{" "}
          <span className="muted">
            ({preview ? preview.label : "no logo yet"})
          </span>
        </span>
        {preview && (
          <div className="logo-preview">
            <div className="logo-preview__light">
              <LogoMask
                url={preview.url}
                label="Logo on the light theme"
                colour={colour}
              />
              <small>Light</small>
            </div>
            <div className="logo-preview__dark">
              <LogoMask
                url={preview.url}
                label="Logo on the dark theme"
                colour={colour}
              />
              <small>Dark</small>
            </div>
          </div>
        )}
      </div>
      <Notice error={save.error} />
    </SidePanel>
  );
}

function UploadOwn({ onFile }: { onFile: (file: EditorSource) => void }) {
  const id = useId();
  const [message, setMessage] = useState("");
  return (
    <div className="logo-drop">
      <label htmlFor={`${id}-file`}>
        <strong>Upload a logo</strong>
      </label>
      <span className="hint" id={`${id}-hint`}>
        SVG, PNG or WebP with a transparent background, up to 1 MB. Only its
        shape is used: it is shown in one solid colour.
      </span>
      <input
        id={`${id}-file`}
        type="file"
        accept="image/svg+xml,image/png,image/webp,.svg,.png,.webp"
        aria-describedby={`${id}-hint ${id}-message`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > MAX_BYTES) {
            setMessage("This file is larger than 1 MB. Choose a smaller one.");
            return;
          }
          // Read as a data: address: the page may show it, and the editor's canvas can read it.
          const reader = new FileReader();
          reader.onload = () => {
            setMessage(
              `${file.name} is in the editor below. Adjust it if you need to, then select Save logo.`,
            );
            onFile({
              label: file.name,
              title: file.name.slice(0, 300),
              url: String(reader.result),
            });
          };
          reader.onerror = () =>
            setMessage("This file could not be read. Choose another.");
          reader.readAsDataURL(file);
        }}
      />
      <span className="hint" id={`${id}-message`} role="status">
        {message}
      </span>
    </div>
  );
}

function FindOnline({
  name,
  people,
  noun,
  chosen,
  onChoose,
}: {
  name: string;
  people: string[];
  noun: string;
  chosen: string | null;
  onChoose: (found: CommonsResult) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState(name);
  const search = useMutation({
    mutationFn: async (q: string) =>
      result(
        await api.GET("/api/logos/commons", {
          params: { query: { q, name, people } },
        }),
      ),
  });
  const items = search.data?.items ?? [];
  const right = items.filter((item) => !item.probable_wrong_match).length;
  const who = people.length ? people.join(" or ") : name;
  return (
    <>
      <form
        className="field"
        role="search"
        aria-label="Find a logo online"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) search.mutate(query.trim());
        }}
      >
        <label className="field__label" htmlFor={`${id}-q`}>
          {noun === "show" ? "Show name" : "Series name"}
        </label>
        <div className="inline-form">
          <input
            className="input"
            id={`${id}-q`}
            value={query}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="btn" disabled={search.isPending}>
            Search
          </button>
        </div>
      </form>
      <p className="hint">
        Storyarr searches Wikimedia Commons, which has logos for some famous
        series. There is no shared database of book series logos.
      </p>
      <p className="hint" role="status">
        {search.isPending
          ? "Searching Wikimedia Commons…"
          : search.isError
            ? "Wikimedia Commons did not answer. Try again, or use another way."
            : search.isSuccess
              ? !items.length
                ? `No logo found for "${search.variables}". Try another way.`
                : right
                  ? `${right} possible ${right === 1 ? "logo" : "logos"} found.`
                  : `No logo for this ${noun}. The closest ${items.length === 1 ? "file is" : "files are"} about something else.`
              : "Select Search to look for a logo."}
      </p>
      {items.length > 0 && (
        <ul className="logo-candidates">
          {items.map((item, index) => (
            <li
              key={item.title}
              className="logo-candidate"
              aria-current={chosen === item.title ? "true" : undefined}
            >
              <span className="logo-candidate__art">
                {item.thumbnail_url && (
                  <img
                    src={item.thumbnail_url}
                    alt={`Preview of ${item.title}`}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                )}
              </span>
              <span className="logo-candidate__text">
                <b id={`${id}-c${index}`}>{item.title}</b>
                <span className="muted">
                  Wikimedia Commons, {item.format.toUpperCase()}, {item.width}{" "}
                  by {item.height}
                </span>
                <span className="muted">
                  Licence: {item.licence || "not stated"}
                </span>
                {item.probable_wrong_match && (
                  <span className="chip" data-tone="warning">
                    Probably not this {noun}: it does not mention {who}
                  </span>
                )}
                {item.source_page && (
                  <a href={item.source_page} target="_blank" rel="noreferrer">
                    File page (opens in a new tab)
                  </a>
                )}
              </span>
              <button
                type="button"
                className="btn"
                aria-describedby={`${id}-c${index}`}
                onClick={() => onChoose(item)}
              >
                {chosen === item.title
                  ? "Chosen: edit it below"
                  : "Use this logo"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
