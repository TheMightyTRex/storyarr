/**
 * The logo editor (UX-43, UX-48): turn a box drawn on a cover, an uploaded file or a Commons file into
 * a one-colour logo with a transparent background. Everything runs in the browser on the pixels of the
 * box; the result is uploaded as a PNG. These are the pure steps, so they can be tested without a canvas.
 */

export type Box = { x: number; y: number; w: number; h: number };
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

/** The top quarter, where series names usually sit. */
export const START_BOX: Box = { x: 0.06, y: 0.04, w: 0.88, h: 0.24 };
/** The whole picture, for an uploaded or found logo. */
export const WHOLE: Box = { x: 0, y: 0, w: 1, h: 1 };

/** Where the shape comes from: dark or light parts, or the picture's own transparency. */
export type Shape = "lightness" | "transparency";
/** How hard to clean: off, small specks, more, most. */
export type Clean = 0 | 1 | 2 | 3;
/** One stroke of the eraser or paintbrush, in fractions of the box; size is a fraction of its width. */
export type Stroke = {
  mode: "erase" | "paint";
  size: number;
  points: { x: number; y: number }[];
};

/** True when more than 2% of the picture is see-through, as a logo file with no background is. */
export function hasTransparency({ data }: Pixels) {
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) clear++;
  return clear > (data.length / 4) * 0.02;
}
const MIN = 0.02;
const STEP = 0.01;

/** Relative lightness of the pixel at byte offset i, 0 to 1. */
export function lightness(data: Uint8ClampedArray, i: number) {
  return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
}

/**
 * Suggested settings for a box: Otsu's threshold (as a percentage), and Invert on when the edges of
 * the box are darker than the threshold, because the background touches the edges.
 */
export function suggest({ width, height, data }: Pixels) {
  const hist = new Array<number>(256).fill(0);
  let n = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const l = Math.round(lightness(data, i) * 255);
    hist[l]++;
    n++;
    sum += l;
  }
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let t = 128;
  for (let k = 0; k < 256; k++) {
    wB += hist[k];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += k * hist[k];
    const v = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (v > best) {
      best = v;
      t = k;
    }
  }
  let edge = 0;
  let count = 0;
  for (let x = 0; x < width; x++)
    for (const y of [0, height - 1]) {
      edge += lightness(data, (y * width + x) * 4);
      count++;
    }
  for (let y = 0; y < height; y++)
    for (const x of [0, width - 1]) {
      edge += lightness(data, (y * width + x) * 4);
      count++;
    }
  return {
    threshold: Math.min(99, Math.max(1, Math.round((t / 255) * 100))),
    invert: count > 0 && edge / count < t / 255,
  };
}

/**
 * Which pixels belong to the logo: darker than the threshold (lighter with invert), or, with the shape
 * from transparency, everything that is not see-through. See-through pixels are never the logo.
 * Cleaning removes small separate pieces (stars, dust) and fills small holes inside the letters; the
 * level sets how small. Then the eraser and paintbrush strokes are applied, and the result is trimmed.
 */
export function cutOut(
  { width: w, height: h, data }: Pixels,
  thresholdPercent: number,
  invert: boolean,
  clean: boolean | Clean,
  { shape = "lightness", edits = [] }: { shape?: Shape; edits?: Stroke[] } = {},
) {
  const t = thresholdPercent / 100;
  const on = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < on.length; p++, i += 4) {
    if (data[i + 3] < 128) continue;
    if (shape === "transparency") {
      on[p] = 1;
      continue;
    }
    const l = lightness(data, i);
    on[p] = (invert ? l > t : l < t) ? 1 : 0;
  }
  let removed = 0;
  const level = clean === true ? 1 : clean === false ? 0 : clean;
  if (level) {
    const min = [
      0,
      Math.max(40, w * h * 0.0008),
      Math.max(80, w * h * 0.003),
      Math.max(160, w * h * 0.01),
    ][level];
    const sweep = (value: number, onlyInside: boolean) => {
      const seen = new Uint8Array(w * h);
      const stack: number[] = [];
      for (let s = 0; s < on.length; s++) {
        if (on[s] !== value || seen[s]) continue;
        const part: number[] = [];
        let edge = false;
        stack.push(s);
        seen[s] = 1;
        while (stack.length) {
          const p = stack.pop()!;
          part.push(p);
          const x = p % w;
          const y = (p / w) | 0;
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
          for (const q of [
            p - w,
            p + w,
            x > 0 ? p - 1 : -1,
            x < w - 1 ? p + 1 : -1,
          ])
            if (q >= 0 && q < on.length && on[q] === value && !seen[q]) {
              seen[q] = 1;
              stack.push(q);
            }
        }
        if (part.length < min && !(onlyInside && edge)) {
          for (const p of part) on[p] = 1 - value;
          if (value) removed++;
        }
      }
    };
    sweep(1, false);
    sweep(0, true);
  }
  for (const stroke of edits) {
    const r = Math.max(1, stroke.size * w);
    const value = stroke.mode === "paint" ? 1 : 0;
    const stamp = (cx: number, cy: number) => {
      for (
        let y = Math.max(0, Math.floor(cy - r));
        y <= Math.min(h - 1, cy + r);
        y++
      )
        for (
          let x = Math.max(0, Math.floor(cx - r));
          x <= Math.min(w - 1, cx + r);
          x++
        )
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) on[y * w + x] = value;
    };
    const points = stroke.points.map((p) => ({ x: p.x * w, y: p.y * h }));
    points.forEach((p, i) => {
      const q = points[i - 1] ?? p;
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(p.x - q.x, p.y - q.y) / (r / 2)),
      );
      for (let s = 0; s <= steps; s++)
        stamp(q.x + ((p.x - q.x) * s) / steps, q.y + ((p.y - q.y) * s) / steps);
    });
  }
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let p = 0; p < on.length; p++)
    if (on[p]) {
      const x = p % w;
      const y = (p / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < 0)
    return {
      width: 0,
      height: 0,
      alpha: new Uint8ClampedArray(),
      removed,
      x0: 0,
      y0: 0,
      fullWidth: w,
      fullHeight: h,
    };
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  // Black with full opacity where the logo is, transparent elsewhere, trimmed to the logo.
  const alpha = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (on[(y + y0) * w + x + x0]) alpha[(y * width + x) * 4 + 3] = 255;
  // Where the trimmed logo sits in the box, so strokes drawn on the cut-out map back to the box.
  return { width, height, alpha, removed, x0, y0, fullWidth: w, fullHeight: h };
}

/** Arrow keys move the box; Shift and arrow keys change its size. It stays on the cover. */
export function moveBox(box: Box, key: string, resize: boolean): Box | null {
  const d = (
    {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    } as Record<string, [number, number]>
  )[key];
  if (!d) return null;
  if (resize)
    return {
      ...box,
      w: Math.min(1 - box.x, Math.max(MIN, box.w + d[0] * STEP)),
      h: Math.min(1 - box.y, Math.max(MIN, box.h + d[1] * STEP)),
    };
  return {
    ...box,
    x: Math.min(1 - box.w, Math.max(0, box.x + d[0] * STEP)),
    y: Math.min(1 - box.h, Math.max(0, box.y + d[1] * STEP)),
  };
}

/** The box between two points, each 0 to 1 across and down the cover. */
export function fromCorners(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.max(MIN, Math.abs(a.x - b.x)),
    h: Math.max(MIN, Math.abs(a.y - b.y)),
  };
}

/** "Box: 7% from the left, 4% from the top, 88% wide, 24% high." */
export function describeBox(box: Box) {
  const pc = (v: number) => Math.round(v * 100);
  return `Box: ${pc(box.x)}% from the left, ${pc(box.y)}% from the top, ${pc(box.w)}% wide, ${pc(box.h)}% high.`;
}
