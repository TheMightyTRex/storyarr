import assert from "node:assert/strict";
import { test } from "node:test";
import { coverImage } from "./coverImages.ts";

test("cover addresses are proxied, kept or refused", () => {
  assert.equal(
    coverImage("https://covers.example/a.jpg"),
    "/api/catalog/cover-image?size=320&url=https%3A%2F%2Fcovers.example%2Fa.jpg",
  );
  assert.equal(
    coverImage("/api/catalog/works/1/cover"),
    "/api/catalog/works/1/cover",
  );
  assert.equal(
    coverImage("data:image/png;base64,AAAA"),
    "data:image/png;base64,AAAA",
  );
  assert.equal(coverImage("javascript:alert(1)"), "");
  assert.equal(coverImage("//elsewhere.example/a.jpg"), "");
});
