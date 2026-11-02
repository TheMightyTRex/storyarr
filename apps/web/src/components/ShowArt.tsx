import { useEffect, useState, type CSSProperties } from "react";

/*
 * A radio show's square artwork in the 2:3 book shape (FEAT-R decision 2, fill 4; the shared
 * library's `.show-art`): the square image at the top, never cropped, and a label below in the
 * image's main colour with the station and the show's name as real text. The colour is read in the
 * browser from Storyarr's own copy of the artwork (same origin); until then, or when there is no
 * image, the label uses a neutral surface.
 */

type Colours = { bg: string; fg: string };
const known = new Map<string, Colours | null>();
const waiting = new Map<string, Promise<Colours | null>>();

function luminance([r, g, b]: number[]) {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** The image's average colour, darkened until white text on it passes 4.5:1 (WCAG 2.2 AA). */
export function labelColours(rgb: number[]): Colours {
  let [r, g, b] = rgb.map((v) => v * 0.7);
  while (luminance([r, g, b]) > 0.18) [r, g, b] = [r * 0.9, g * 0.9, b * 0.9];
  return {
    bg: `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`,
    fg: "#fff",
  };
}

function read(url: string): Promise<Colours | null> {
  if (known.has(url)) return Promise.resolve(known.get(url)!);
  const pending = waiting.get(url);
  if (pending) return pending;
  const promise = new Promise<Colours | null>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 16;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, 16, 16);
        const data = context.getImageData(0, 0, 16, 16).data;
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
        resolve(n ? labelColours([r / n, g / n, b / n]) : null);
      } catch {
        // A copy from another origin cannot be read; the neutral label stays.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  }).then((value) => {
    known.set(url, value);
    waiting.delete(url);
    return value;
  });
  waiting.set(url, promise);
  return promise;
}

/** The label colours for a locally served image, or null while unknown (neutral surface). */
export function useMainColour(url?: string | null) {
  const [colours, setColours] = useState<Colours | null>(() =>
    url ? (known.get(url) ?? null) : null,
  );
  useEffect(() => {
    if (!url) return setColours(null);
    let live = true;
    void read(url).then((value) => live && setColours(value));
    return () => {
      live = false;
    };
  }, [url]);
  return colours;
}

export default function ShowArt({
  title,
  station,
  artwork,
  className = "",
}: {
  title: string;
  /** The station's name, or null when the show has none. */
  station?: string | null;
  /** Storyarr's own copy of the artwork (/api/radio/shows/{id}/artwork). */
  artwork?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState<string>();
  const image = artwork && artwork !== failed ? artwork : null;
  const colours = useMainColour(image);
  const style = colours
    ? ({
        "--show-art-bg": colours.bg,
        "--show-art-fg": colours.fg,
      } as CSSProperties)
    : undefined;
  return (
    <div
      className={`show-art ${className}`}
      role="img"
      aria-label={station ? `${title}, ${station}` : title}
      style={style}
    >
      {image ? (
        <img
          className="show-art__img"
          src={image}
          alt=""
          loading="lazy"
          onError={() => setFailed(image)}
        />
      ) : (
        <span className="show-art__text" aria-hidden="true">
          {title}
        </span>
      )}
      <span className="show-art__label" aria-hidden="true">
        <span className="show-art__station">
          {station || "No station given"}
        </span>
        <span className="show-art__name">{title}</span>
      </span>
    </div>
  );
}
