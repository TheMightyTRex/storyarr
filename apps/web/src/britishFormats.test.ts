import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Dates, times and numbers are written the British way on every page, whatever the browser's language
// ("2 November 2026", "17:30"), so no call may fall back to the browser's own locale.
const root = new URL(".", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "shared" ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

test("every date, time and number format names en-GB", () => {
  const loose: string[] = [];
  for (const file of sources(root)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /toLocale(?:Date|Time)?String\(([^)]*)\)|Intl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat)\(([^)]*)\)/g,
    )) {
      const args = (match[1] ?? match[2] ?? "").trim();
      if (!args.startsWith('"en-GB"'))
        loose.push(`${file.slice(root.length)}: ${match[0]}`);
    }
  }
  assert.deepEqual(loose, []);
});

test("no date is written as numbers alone (12/05/2020)", () => {
  // toLocaleDateString("en-GB") and toLocaleString("en-GB") with no options give "12/05/2020"; the content
  // guide wants "12 May 2020". Use longDate, shortDate or dateAndTime from dates.ts.
  const numeric: string[] = [];
  for (const file of sources(root)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /toLocaleDateString\(\s*"en-GB"\s*,?\s*\)|Date\([^()]*\)\.toLocaleString\(\s*"en-GB"\s*,?\s*\)/g,
    ))
      numeric.push(`${file.slice(root.length)}: ${match[0]}`);
  }
  assert.deepEqual(numeric, []);
});
