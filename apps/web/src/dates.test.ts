import assert from "node:assert/strict";
import { test } from "node:test";
import { dateAndTime, longDate, shortDate } from "./dates.ts";

test("dates are written day, month, year, never with numbers alone", () => {
  assert.equal(longDate("2020-05-12"), "12 May 2020");
  assert.equal(shortDate("2020-05-12"), "12 May 2020");
  assert.equal(shortDate("2020-09-03"), "3 Sep 2020");
  assert.equal(longDate("2026-11-03T23:30:00Z").includes("2026"), true);
  assert.match(dateAndTime("2026-11-03T09:30:00"), /^3 November 2026, 09:30$/);
  assert.equal(longDate("not a date"), "");
});

test("a date alone is the same calendar day in every time zone", () => {
  assert.equal(longDate("2020-01-01"), "1 January 2020");
  assert.equal(longDate("2020-12-31"), "31 December 2020");
});
