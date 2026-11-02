import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import {
  cutOut,
  describeBox,
  fromCorners,
  hasTransparency,
  moveBox,
  suggest,
  type Box,
  type Clean,
  type Shape,
  type Stroke,
} from "../logoCutout";

/** A picture the logo can be made from, at an address the canvas may read (Storyarr's own, or data:). */
export type EditorSource = { label: string; title: string; url: string };

/** The edited logo: a PNG, with a data: address the page may show (the page refuses blob: images). */
export type EditorResult = {
  blob: Blob;
  url: string;
  title: string;
  label: string;
};

const SIZES = { small: 0.008, medium: 0.02 } as const;
const CLEAN_LEVELS: [Clean, string][] = [
  [0, "Off"],
  [1, "Small specks"],
  [2, "More"],
  [3, "Most"],
];

/**
 * The logo editor (UX-43, UX-48), on every way to get a logo: choose the picture (when there are
 * several), draw a box around the logo, make it one colour by lightness or by the picture's own
 * transparency, clean up specks at one of four strengths, then touch it up with a small eraser and
 * paintbrush. The result is a one-colour PNG with a transparent background.
 */
export default function LogoEditor({
  sources,
  chooseLegend,
  startBox,
  picture,
  describe,
  onCut,
}: {
  sources: EditorSource[];
  /** The legend for choosing between several pictures, such as "Choose a cover"; none for one. */
  chooseLegend?: string;
  startBox: Box;
  /** "cover", "picture" or "file", for the words beside Invert. */
  picture: string;
  /** Where the logo came from, for the saved copy ("the cover of Low Water, book 6") and the preview. */
  describe: (source: EditorSource) => { title: string; label: string };
  onCut: (result: EditorResult) => void;
}) {
  const id = useId();
  const crop = useRef<HTMLCanvasElement>(null);
  const cutCanvas = useRef<HTMLCanvasElement>(null);
  const [current, setCurrent] = useState(0);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<Box>(startBox);
  const [shape, setShape] = useState<Shape>("lightness");
  const [threshold, setThreshold] = useState(50);
  const [invert, setInvert] = useState(false);
  const [clean, setClean] = useState<Clean>(1);
  const [tool, setTool] = useState<"box" | "erase" | "paint">("box");
  const [size, setSize] = useState<keyof typeof SIZES>("small");
  const [edits, setEdits] = useState<Stroke[]>([]);
  const [status, setStatus] = useState("");
  const [corner, setCorner] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{
    start: { x: number; y: number };
    moved: boolean;
  } | null>(null);
  const stroke = useRef<Stroke | null>(null);
  const source = sources[current];
  const pictureWord = picture;

  // Load the chosen picture. It comes from Storyarr's own address or a data: address, so the canvas
  // can read it.
  useEffect(() => {
    if (!source) return;
    let live = true;
    setImage(null);
    setStatus(`Loading the ${pictureWord}.`);
    const next = new window.Image();
    next.onload = () => {
      if (!live) return;
      setImage(next);
      setBox(startBox);
      setCorner(null);
      setEdits([]);
      prepare(next, startBox);
    };
    next.onerror = () =>
      live &&
      setStatus(
        `The ${pictureWord} did not load. Choose another, or use another way.`,
      );
    next.src = source.url;
    return () => {
      live = false;
    };
  }, [source?.url]);

  function pixels(img: HTMLImageElement, area: Box) {
    const W = img.naturalWidth || 1200;
    const H = img.naturalHeight || 300;
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
    context.drawImage(img, b.x, b.y, b.w, b.h, 0, 0, w, h);
    return { width: w, height: h, data: context.getImageData(0, 0, w, h).data };
  }

  /** Suggested settings for a new picture or box: its own transparency when it has one. */
  function prepare(img: HTMLImageElement, area: Box) {
    try {
      const read = pixels(img, area);
      // A logo file with no background is clean already: keep every small part (a dot, a lamp).
      const clear = hasTransparency(read);
      setShape(clear ? "transparency" : "lightness");
      setClean(clear ? 0 : 1);
      const found = suggest(read);
      setThreshold(found.threshold);
      setInvert(found.invert);
    } catch {
      setStatus(
        `This ${pictureWord} cannot be read here. Choose another, or use another way.`,
      );
    }
  }

  // Draw the picture with the box, then cut the logo out of the box.
  useEffect(() => {
    const canvas = crop.current;
    if (!image || !canvas) return;
    const W = image.naturalWidth || 1200;
    const H = image.naturalHeight || 300;
    canvas.width = W;
    canvas.height = H;
    const context = canvas.getContext("2d")!;
    const b = {
      x: box.x * W,
      y: box.y * H,
      w: Math.max(4, box.w * W),
      h: Math.max(4, box.h * H),
    };
    // White behind the picture, so a dark logo file with no background shows in every theme.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, W, H);
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

    let read;
    try {
      read = pixels(image, box);
    } catch {
      setStatus(
        `This ${pictureWord} cannot be read here. Choose another, or use another way.`,
      );
      return;
    }
    const cut = cutOut(read, threshold, invert, clean, { shape, edits });
    const shown = cutCanvas.current;
    if (!shown) return;
    // The whole box is shown, so the eraser and paintbrush can reach any part of it.
    shown.width = cut.fullWidth;
    shown.height = cut.fullHeight;
    const view = shown.getContext("2d")!;
    view.clearRect(0, 0, shown.width, shown.height);
    if (!cut.width) {
      setStatus(
        shape === "transparency"
          ? "Nothing is left. Try the shape from lightness, or undo an edit."
          : "Nothing is left. Move the threshold, or turn Invert on or off.",
      );
      return;
    }
    view.putImageData(
      new ImageData(cut.alpha, cut.width, cut.height),
      cut.x0,
      cut.y0,
    );
    setStatus(
      `${cut.width} by ${cut.height} pixels${cut.removed ? `, ${cut.removed} ${cut.removed === 1 ? "speck" : "specks"} removed` : ""}${edits.length ? `, ${edits.length} ${edits.length === 1 ? "edit" : "edits"}` : ""}.`,
    );
    // The saved file is trimmed to the logo.
    const out = document.createElement("canvas");
    out.width = cut.width;
    out.height = cut.height;
    out
      .getContext("2d")!
      .putImageData(new ImageData(cut.alpha, cut.width, cut.height), 0, 0);
    const url = out.toDataURL("image/png");
    const words = describe(source);
    let live = true;
    out.toBlob((blob) => {
      if (live && blob) onCut({ blob, url, ...words });
    }, "image/png");
    return () => {
      live = false;
    };
  }, [image, box, shape, threshold, invert, clean, edits, corner]);

  function at(event: PointerEvent<HTMLCanvasElement>) {
    const r = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (event.clientY - r.top) / r.height)),
    };
  }
  function settle(next: Box) {
    setBox(next);
    setEdits([]);
    if (image) prepare(image, next);
  }
  /** Shows a stroke on the cut-out while it is drawn; it is applied when the pointer lifts. */
  function sketch(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    const canvas = cutCanvas.current;
    const now = stroke.current;
    if (!canvas || !now) return;
    const view = canvas.getContext("2d")!;
    view.globalCompositeOperation =
      now.mode === "erase" ? "destination-out" : "source-over";
    view.strokeStyle = "#000";
    view.lineCap = "round";
    view.lineWidth = now.size * canvas.width * 2;
    view.beginPath();
    view.moveTo(from.x * canvas.width, from.y * canvas.height);
    view.lineTo(to.x * canvas.width, to.y * canvas.height);
    view.stroke();
    view.globalCompositeOperation = "source-over";
  }

  if (!sources.length) return null;
  const step = (n: number) => `${n + (chooseLegend ? 1 : 0)}.`;
  return (
    <>
      {chooseLegend && (
        <fieldset className="field">
          <legend className="logo-step">1. {chooseLegend}</legend>
          <div className="cover-pick">
            {sources.map((item, index) => (
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
            The pictures come from Storyarr, so any of them can be used.
          </span>
        </fieldset>
      )}
      <div className="logo-crop">
        <div className="field">
          <span className="logo-step" id={`${id}-crop`}>
            {step(1)} Draw a box around the logo
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
              setEdits([]);
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
          <span className="logo-step">{step(2)} Make it one colour</span>
          <fieldset className="field">
            <legend className="field__label">Shape from</legend>
            <div className="segmented">
              {(
                [
                  ["lightness", "Lightness"],
                  ["transparency", "Transparency"],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`${id}-shape`}
                    checked={shape === value}
                    onChange={() => setShape(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <span className="hint">
              Transparency keeps the shape of a logo file with no background.
              Lightness cuts a logo out of a picture.
            </span>
          </fieldset>
          {shape === "lightness" && (
            <>
              <div className="field">
                <label className="field__label" htmlFor={`${id}-threshold`}>
                  Threshold:{" "}
                  <output htmlFor={`${id}-threshold`}>{threshold}%</output>
                </label>
                <span className="hint" id={`${id}-threshold-hint`}>
                  Parts darker than this become the logo (lighter, with Invert
                  on). Move it until the letters are solid and the background
                  has gone.
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
                  onClick={() => image && prepare(image, box)}
                >
                  Use the suggested threshold
                </button>
              </div>
              <label className="switch">
                <span>Invert: for a light logo on a dark {pictureWord}</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={invert}
                  onChange={(event) => setInvert(event.target.checked)}
                />
              </label>
            </>
          )}
          <fieldset className="field">
            <legend className="field__label">
              Clean up specks and small holes
            </legend>
            <div className="segmented">
              {CLEAN_LEVELS.map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`${id}-clean`}
                    checked={clean === value}
                    onChange={() => setClean(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <span className="hint">
              Stronger levels remove bigger dots and fill bigger holes in the
              letters.
            </span>
          </fieldset>
          <span className="logo-step">{step(3)} Touch it up</span>
          <fieldset className="field">
            <legend className="field__label">Tool</legend>
            <div className="segmented">
              {(
                [
                  ["box", "None"],
                  ["erase", "Eraser"],
                  ["paint", "Paintbrush"],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`${id}-tool`}
                    checked={tool === value}
                    onChange={() => setTool(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {tool !== "box" && (
            <fieldset className="field">
              <legend className="field__label">Size</legend>
              <div className="segmented">
                {(
                  [
                    ["small", "Small"],
                    ["medium", "Medium"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name={`${id}-size`}
                      checked={size === value}
                      onChange={() => setSize(value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="field">
            <span className="field__label" id={`${id}-cut`}>
              Cut-out (the checks show what is transparent)
            </span>
            <span className="hint" id={`${id}-cut-hint`}>
              {tool === "box"
                ? "Choose the eraser or paintbrush to draw on the cut-out."
                : `Draw on the cut-out to ${tool === "erase" ? "rub out" : "fill in"} parts of the logo.`}
            </span>
            <div className="checker" data-tool={tool}>
              <canvas
                ref={cutCanvas}
                width={10}
                height={10}
                role="img"
                aria-labelledby={`${id}-cut`}
                aria-describedby={`${id}-cut-hint`}
                onPointerDown={(event) => {
                  if (tool === "box" || !image) return;
                  const p = at(event);
                  stroke.current = {
                    mode: tool,
                    size: SIZES[size],
                    points: [p],
                  };
                  sketch(p, p);
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const now = stroke.current;
                  if (!now) return;
                  const p = at(event);
                  sketch(now.points[now.points.length - 1], p);
                  now.points.push(p);
                }}
                onPointerUp={() => {
                  const now = stroke.current;
                  stroke.current = null;
                  if (now) setEdits((list) => [...list, now]);
                }}
              />
            </div>
            <div className="series-head__actions">
              <button
                type="button"
                className="btn btn--quiet"
                disabled={!edits.length}
                onClick={() => setEdits((list) => list.slice(0, -1))}
              >
                Undo last edit
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                disabled={!edits.length}
                onClick={() => setEdits([])}
              >
                Clear edits
              </button>
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
