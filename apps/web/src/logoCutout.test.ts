import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cutOut,
  fromCorners,
  hasTransparency,
  moveBox,
  suggest,
} from "./logoCutout.ts";

/** A 40 by 20 box: a light 20 by 8 block on a dark background, with one light speck. */
function sample() {
  const width = 40;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const light =
        (x >= 10 && x < 30 && y >= 6 && y < 14) || (x === 2 && y === 2);
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = light ? 230 : 20;
      data[i + 3] = 255;
    }
  return { width, height, data };
}

test("a light logo on a dark cover suggests Invert", () => {
  const { threshold, invert } = suggest(sample());
  assert.equal(invert, true);
  assert.ok(threshold > 5 && threshold < 90);
});

test("the cut-out keeps the logo, trims it and drops specks", () => {
  const cut = cutOut(sample(), 50, true, true);
  assert.equal(cut.width, 20);
  assert.equal(cut.height, 8);
  assert.equal(cut.removed, 1);
  assert.equal(cut.alpha[3], 255);
  const kept = cutOut(sample(), 50, true, false);
  assert.equal(kept.width, 28);
  assert.equal(cutOut(sample(), 95, true, true).width, 0);
});

test("see-through pixels are never the logo, and the shape can come from transparency", () => {
  // A dark 10 by 4 mark on a fully transparent background, as a logo file usually is.
  const width = 20;
  const height = 10;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 3; y < 7; y++)
    for (let x = 5; x < 15; x++) {
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 200; // light, so lightness alone would miss it
      data[i + 3] = 255;
    }
  const file = { width, height, data };
  assert.equal(hasTransparency(file), true);
  assert.equal(hasTransparency(sample()), false);
  // By lightness, the transparent (black, see-through) background is not taken as the logo.
  assert.equal(cutOut(file, 50, false, false).width, 0);
  const shape = cutOut(file, 50, false, false, { shape: "transparency" });
  assert.deepEqual(
    [shape.width, shape.height, shape.x0, shape.y0],
    [10, 4, 5, 3],
  );
});

test("stronger cleaning removes bigger specks", () => {
  // The logo block, plus an 8 by 6 light blot that the small level keeps and Most removes.
  const box = sample();
  for (let y = 14; y < 20; y++)
    for (let x = 32; x < 40; x++) {
      const i = (y * box.width + x) * 4;
      box.data[i] = box.data[i + 1] = box.data[i + 2] = 230;
    }
  assert.equal(cutOut(box, 50, true, 1).removed, 1);
  assert.equal(cutOut(box, 50, true, 3).removed, 2);
  assert.equal(cutOut(box, 50, true, 0).removed, 0);
});

test("eraser and paintbrush strokes change the cut-out", () => {
  // Erase the left half of the block; paint a dot at the top right corner.
  const erased = cutOut(sample(), 50, true, true, {
    edits: [
      {
        mode: "erase",
        size: 0.15,
        points: [
          { x: 0.3, y: 0.5 },
          { x: 0.45, y: 0.5 },
        ],
      },
    ],
  });
  assert.ok(erased.width < 20 && erased.x0 > 10);
  const painted = cutOut(sample(), 50, true, true, {
    edits: [{ mode: "paint", size: 0.03, points: [{ x: 0.95, y: 0.1 }] }],
  });
  assert.ok(painted.width > 20 && painted.y0 < 6);
});

test("the box moves and resizes with the keyboard and stays on the cover", () => {
  const box = { x: 0.95, y: 0, w: 0.05, h: 0.1 };
  assert.deepEqual(moveBox(box, "ArrowRight", false), box);
  assert.equal(moveBox(box, "ArrowLeft", false)!.x.toFixed(2), "0.94");
  assert.equal(moveBox(box, "ArrowDown", true)!.h.toFixed(2), "0.11");
  assert.equal(moveBox(box, "Enter", false), null);
  assert.deepEqual(fromCorners({ x: 0.5, y: 0.5 }, { x: 0.1, y: 0.2 }), {
    x: 0.1,
    y: 0.2,
    w: 0.4,
    h: 0.3,
  });
});
