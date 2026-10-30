import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestedAudibleStore } from "./audibleStores.ts";

test("the Audible store follows the browser's country", () => {
  assert.equal(suggestedAudibleStore(["en-GB", "en"]), "uk");
  assert.equal(suggestedAudibleStore(["en-AU"]), "au");
  assert.equal(suggestedAudibleStore(["fr-CA"]), "ca");
});

test("a language with no country picks that language's store, else the US store", () => {
  assert.equal(suggestedAudibleStore(["de"]), "de");
  assert.equal(suggestedAudibleStore(["ja"]), "jp");
  assert.equal(suggestedAudibleStore(["en"]), "us");
  assert.equal(suggestedAudibleStore([]), "us");
});
