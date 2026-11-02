import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useMutation } from "@tanstack/react-query";
import { BookOpen, Globe, HardDrive, Image, Upload } from "lucide-react";
import type { components } from "../api/schema";
import { api, ApiError, result } from "../api/client";
import { Notice } from "../components";
import SidePanel from "./SidePanel";
import LogoMask from "./LogoMask";
import {
  START_BOX,
  cutOut,
  describeBox,
  fromCorners,
  moveBox,
  suggest,
  type Box,
} from "../logoCutout";

export type Logo = components["schemas"]["LogoView"];
type Colour = "text" | "accent";
type CommonsResult = components["schemas"]["CommonsResult"];
/** Whose logo: a series (shared by everyone, admins change it) or a radio show (its owner). */
export type LogoTarget =
  { kind: "series"; externalId: string } | { kind: "show"; showId: string };
/** A cover (or a show's artwork) the logo can be cut from, served by Storyarr itself. */
export type LogoCover = { label: string; title: string; url: string };
type Pending =
  | {
      kind: "file";
      blob: Blob;
      url: string;
      source: "upload" | "cover";
      title: string;
      label: string;
    }
  | { kind: "commons"; title: string; url: string | null; label: string };

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
  query: { source: "upload" | "cover"; title: string; colour: Colour },
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

async function fromCommons(target: LogoTarget, title: string, colour: Colour) {
  return target.kind === "series"
    ? result(
        await api.POST(
          "/api/catalog/series/hardcover/{external_id}/logo/commons",
          {
            params: { path: { external_id: target.externalId } },
            body: { title, colour },
          },
        ),
      )
    : result(
        await api.POST("/api/radio/shows/{show_id}/logo/commons", {
          params: { path: { show_id: target.showId } },
          body: { title, colour },
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
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(
    () => () => {
      if (pending?.kind === "file") URL.revokeObjectURL(pending.url);
    },
    [pending],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (pending?.kind === "file")
        return upload(target, pending.blob, {
          source: pending.source,
          title: pending.title,
          colour,
        });
      if (pending?.kind === "commons")
        return fromCommons(target, pending.title, colour);
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
      requestAnimationFrame(() => savedNone.current?.focus());
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
          {item.key === "cover" && tab === "cover" && (
            <CoverCutout
              covers={covers}
              show={show}
              onCut={(cut) => setPending(cut)}
            />
          )}
          {item.key === "find" && (
            <FindOnline
              name={name}
              people={people}
              noun={noun}
              chosen={pending?.kind === "commons" ? pending.title : null}
              onChoose={(found) =>
                setPending({
                  kind: "commons",
                  title: found.title,
                  url: found.thumbnail_url ?? null,
                  label: found.title,
                })
              }
            />
          )}
          {item.key === "upload" && (
            <UploadOwn
              onFile={(file) =>
                setPending({
                  kind: "file",
                  blob: file,
                  url: URL.createObjectURL(file),
                  source: "upload",
                  title: file.name.slice(0, 300),
                  label: file.name,
                })
              }
            />
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

function UploadOwn({ onFile }: { onFile: (file: File) => void }) {
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
          setMessage(
            `${file.name} is ready. Select Save logo to keep it. Storyarr checks the file when it is saved.`,
          );
          onFile(file);
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
                  <LogoMask
                    url={item.thumbnail_url}
                    label={`Preview of ${item.title}`}
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
                {chosen === item.title ? "Chosen" : "Use this logo"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CoverCutout({
  covers,
  show,
  onCut,
}: {
  covers: LogoCover[];
  show: boolean;
  onCut: (cut: Pending) => void;
}) {
  const id = useId();
  const crop = useRef<HTMLCanvasElement>(null);
  const cutCanvas = useRef<HTMLCanvasElement>(null);
  const [current, setCurrent] = useState(0);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<Box>(START_BOX);
  const [threshold, setThreshold] = useState(50);
  const [invert, setInvert] = useState(false);
  const [clean, setClean] = useState(true);
  const [status, setStatus] = useState("");
  const [corner, setCorner] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{
    start: { x: number; y: number };
    moved: boolean;
  } | null>(null);
  const cover = covers[current];

  // Load the chosen cover. Covers come from Storyarr's own address, so the canvas can read them.
  useEffect(() => {
    if (!cover) return;
    let live = true;
    setImage(null);
    setStatus(show ? "Loading the artwork." : "Loading the cover.");
    const next = new window.Image();
    next.onload = () => {
      if (!live) return;
      setImage(next);
      setBox(START_BOX);
      setCorner(null);
      suggestFor(next, START_BOX);
    };
    next.onerror = () =>
      live &&
      setStatus(
        show
          ? "The artwork did not load. Upload a logo instead."
          : "The cover did not load. Choose another cover, or upload a logo.",
      );
    next.src = cover.url;
    return () => {
      live = false;
    };
  }, [cover?.url]);

  function pixels(source: HTMLImageElement, area: Box) {
    const W = source.naturalWidth;
    const H = source.naturalHeight;
    const b = {
      x: Math.round(area.x * W),
      y: Math.round(area.y * H),
      w: Math.max(4, Math.round(area.w * W)),
      h: Math.max(4, Math.round(area.h * H)),
    };
    // Scaled up, so the edges of the cut-out are smoother.
    const scale = Math.min(3, 1200 / b.w);
    const w = Math.max(1, Math.round(b.w * scale));
    const h = Math.max(1, Math.round(b.h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, b.x, b.y, b.w, b.h, 0, 0, w, h);
    return { width: w, height: h, data: context.getImageData(0, 0, w, h).data };
  }

  function suggestFor(source: HTMLImageElement, area: Box) {
    try {
      const found = suggest(pixels(source, area));
      setThreshold(found.threshold);
      setInvert(found.invert);
    } catch {
      setStatus(
        "This picture cannot be read here. Choose another, or upload a logo.",
      );
    }
  }

  // Draw the cover with the box, then cut the logo out of the box.
  useEffect(() => {
    const canvas = crop.current;
    if (!image || !canvas) return;
    const W = image.naturalWidth;
    const H = image.naturalHeight;
    canvas.width = W;
    canvas.height = H;
    const context = canvas.getContext("2d")!;
    const b = {
      x: box.x * W,
      y: box.y * H,
      w: Math.max(4, box.w * W),
      h: Math.max(4, box.h * H),
    };
    context.drawImage(image, 0, 0, W, H);
    context.fillStyle = "rgba(0,0,0,.6)";
    context.fillRect(0, 0, W, b.y);
    context.fillRect(0, b.y + b.h, W, H - b.y - b.h);
    context.fillRect(0, b.y, b.x, b.h);
    context.fillRect(b.x + b.w, b.y, W - b.x - b.w, b.h);
    const line = Math.max(2, W / 200);
    context.lineWidth = line;
    context.strokeStyle = "#fff";
    context.strokeRect(b.x + line / 2, b.y + line / 2, b.w - line, b.h - line);
    context.setLineDash([line * 2, line * 2]);
    context.strokeStyle = "#000";
    context.strokeRect(b.x + line / 2, b.y + line / 2, b.w - line, b.h - line);
    context.setLineDash([]);
    if (corner) {
      context.fillStyle = "#fff";
      context.fillRect(corner.x * W - 6, corner.y * H - 6, 12, 12);
    }

    let source;
    try {
      source = pixels(image, box);
    } catch {
      setStatus(
        "This picture cannot be read here. Choose another, or upload a logo.",
      );
      return;
    }
    const cut = cutOut(source, threshold, invert, clean);
    const out = cutCanvas.current;
    if (!out) return;
    if (!cut.width) {
      out.width = 10;
      out.height = 10;
      setStatus(
        "Nothing is left. Move the threshold, or turn Invert on or off.",
      );
      return;
    }
    out.width = cut.width;
    out.height = cut.height;
    out
      .getContext("2d")!
      .putImageData(new ImageData(cut.alpha, cut.width, cut.height), 0, 0);
    setStatus(
      `${cut.width} by ${cut.height} pixels${cut.removed ? `, ${cut.removed} ${cut.removed === 1 ? "speck" : "specks"} removed` : ""}.`,
    );
    const what = show
      ? "the artwork"
      : `the cover of ${cover.title}${cover.label ? `, ${cover.label.toLowerCase()}` : ""}`;
    let live = true;
    out.toBlob((blob) => {
      if (!live || !blob) return;
      onCut({
        kind: "file",
        blob,
        url: URL.createObjectURL(blob),
        source: "cover",
        title: what.slice(0, 300),
        label: show
          ? "cut from the artwork"
          : `cut from ${cover.label.toLowerCase()}`,
      });
    }, "image/png");
    return () => {
      live = false;
    };
  }, [image, box, threshold, invert, clean, corner]);

  function at(event: PointerEvent<HTMLCanvasElement>) {
    const r = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (event.clientY - r.top) / r.height)),
    };
  }
  function settle(next: Box) {
    setBox(next);
    if (image) suggestFor(image, next);
  }

  if (!covers.length)
    return (
      <p className="muted">
        {show
          ? "This show has no artwork saved. Upload a logo instead."
          : "This series has no covers yet. Upload a logo instead."}
      </p>
    );
  return (
    <>
      {!show && (
        <fieldset className="field">
          <legend className="logo-step">1. Choose a cover</legend>
          <div className="cover-pick">
            {covers.map((item, index) => (
              <label key={item.url}>
                <input
                  type="radio"
                  name={`${id}-cover`}
                  checked={current === index}
                  onChange={() => setCurrent(index)}
                />
                <img src={item.url} alt="" />
                <span>
                  {item.label}
                  <span className="sr-only">, {item.title}</span>
                </span>
              </label>
            ))}
          </div>
          <span className="hint">
            The covers come from Storyarr, so any of them can be used.
          </span>
        </fieldset>
      )}
      <div className="logo-crop">
        <div className="field">
          <span className="logo-step" id={`${id}-crop`}>
            {show ? "1." : "2."} Draw a box around the logo
          </span>
          <span className="hint" id={`${id}-crop-hint`}>
            Drag across the logo, or select two opposite corners. With a
            keyboard: arrow keys move the box, Shift and arrow keys change its
            size.
          </span>
          <canvas
            ref={crop}
            className="logo-crop__canvas"
            width={348}
            height={500}
            tabIndex={0}
            role="img"
            aria-labelledby={`${id}-crop`}
            aria-describedby={`${id}-crop-hint ${id}-readout`}
            onPointerDown={(event) => {
              if (!image) return;
              drag.current = { start: at(event), moved: false };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => {
              const now = drag.current;
              if (!now) return;
              const p = at(event);
              if (Math.hypot(p.x - now.start.x, p.y - now.start.y) > 0.015) {
                now.moved = true;
                setCorner(null);
                setBox(fromCorners(now.start, p));
              }
            }}
            onPointerUp={(event) => {
              const now = drag.current;
              if (!now) return;
              const p = at(event);
              drag.current = null;
              if (now.moved) settle(fromCorners(now.start, p));
              else if (!corner) setCorner(p);
              else {
                setCorner(null);
                settle(fromCorners(corner, p));
              }
            }}
            onKeyDown={(event) => {
              const next = moveBox(box, event.key, event.shiftKey);
              if (!next || !image) return;
              event.preventDefault();
              setBox(next);
            }}
          />
          <span
            className="logo-crop__readout"
            id={`${id}-readout`}
            aria-live="polite"
          >
            {corner
              ? "First corner set. Select the opposite corner."
              : describeBox(box)}
          </span>
        </div>
        <div className="logo-crop__controls">
          <span className="logo-step">
            {show ? "2." : "3."} Make it one colour
          </span>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-threshold`}>
              Threshold:{" "}
              <output htmlFor={`${id}-threshold`}>{threshold}%</output>
            </label>
            <span className="hint" id={`${id}-threshold-hint`}>
              Parts darker than this become the logo (lighter, with Invert on).
              Move it until the letters are solid and the background has gone.
            </span>
            <input
              className="range"
              type="range"
              id={`${id}-threshold`}
              min={1}
              max={99}
              value={threshold}
              aria-describedby={`${id}-threshold-hint`}
              onChange={(event) => setThreshold(Number(event.target.value))}
            />
            <button
              type="button"
              className="btn btn--quiet"
              style={{ justifySelf: "start" }}
              disabled={!image}
              onClick={() => image && suggestFor(image, box)}
            >
              Use the suggested threshold
            </button>
          </div>
          <label className="switch">
            <span>
              Invert: for a light logo on a dark {show ? "picture" : "cover"}
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={invert}
              onChange={(event) => setInvert(event.target.checked)}
            />
          </label>
          <label className="switch">
            <span>Clean up specks and small holes</span>
            <input
              type="checkbox"
              role="switch"
              checked={clean}
              onChange={(event) => setClean(event.target.checked)}
            />
          </label>
          <div className="field">
            <span className="field__label">
              Cut-out (the checks show what is transparent)
            </span>
            <div className="checker">
              <canvas
                ref={cutCanvas}
                width={10}
                height={10}
                role="img"
                aria-label="Cut-out of the logo"
              />
            </div>
            <span className="hint" role="status">
              {status}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
