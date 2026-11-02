import assert from "node:assert/strict";
import { test } from "node:test";
import { cutOut, fromCorners, moveBox, suggest } from "./logoCutout.ts";

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
