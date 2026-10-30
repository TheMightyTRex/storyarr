import { expect, test } from "../fixtures";

test("an audiobook can be matched to an Audible recording, with narrator and length shown", async ({
  page,
}) => {
  const imports: string[] = [];
  const matches: unknown[] = [];
  const searches: (string | null)[] = [];
  const item = {
    id: "a1",
    library_id: "library",
    library_name: "Audiobooks",
    server_kind: "audiobookshelf",
    external_id: "a1",
    medium: "audio",
    state: "present",
    title: "Murderbot 1",
    authors: ["Martha Wells"],
    narrators: ["Kevin R. Free"],
    series: [],
    work_ids: [],
    works: [],
    match_status: "needs-review",
    match_revision: "rev-1",
    read_issues: [],
    files: [{ path: "/audiobooks/Murderbot 1/part1.m4b" }],
    open_url: "https://abs.example.test/item/a1",
  };
  const recording = (asin: string, narrator: string, minutes: number) => ({
    provider: "audible",
    external_id: asin,
    title: "All Systems Red",
    authors: ["Martha Wells"],
    publication_year: 2017,
    editions: [
      {
        external_id: asin,
        medium: "audio",
        narrators: [narrator],
        runtime_minutes: minutes,
      },
    ],
    series: [
      { external_id: "s1", name: "The Murderbot Diaries", position: "1" },
    ],
    subjects: [],
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me")
      data = {
        csrf_token: "test",
        user: {
          id: "admin",
          role: "admin",
          username: "admin",
          display_name: "Reader",
        },
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/library/review/summary")
      data = { total: 1, needs_matching: 1, read_issues: 0, reasons: [] };
    else if (path === "/api/library/review")
      data = { items: [{ kind: "asset", asset: item }], total: 1 };
    else if (path === "/api/catalog/works") data = { items: [], total: 0 };
    else if (path === "/api/metadata/search") {
      searches.push(url.searchParams.get("provider"));
      data = {
        provider: "audible",
        items: [
          recording("B06XKBZ6NC", "Kevin R. Free", 194),
          recording("B0OTHER001", "Someone Else", 201),
        ],
        known_works: {},
        page: 1,
        has_more: false,
      };
    } else if (path.endsWith("/import") && method === "POST") {
      imports.push(path);
      data = {
        id: "00000000-0000-0000-0000-000000000099",
        title: "All Systems Red",
        authors: ["Martha Wells"],
        availability: {
          owned: false,
          audio: false,
          ebook: false,
          stale: false,
        },
      };
    } else if (path.endsWith("/match") && method === "POST") {
      matches.push(route.request().postDataJSON());
      data = { ok: true };
    }
    await route.fulfill({ json: data });
  });

  await page.goto("/review");
  await page
    .getByRole("article", { name: "Murderbot 1" })
    .getByRole("button", { name: "Find the book" })
    .click();
  const detail = page.getByRole("dialog", { name: "Review library item" });
  await detail
    .getByLabel("Search catalog", { exact: true })
    .fill("All Systems Red");
  // Audible is searched only when asked, to keep requests to Audible low.
  await expect(
    detail.getByText("No catalog matches.", { exact: false }),
  ).toBeVisible();
  expect(searches).toEqual([]);
  await detail.getByRole("button", { name: "Search Audible" }).click();
  const match = detail.getByRole("radio", { name: /Kevin R\. Free/ });
  await expect(match).toBeVisible();
  const row = detail.locator(".audible-candidate").first();
  await expect(row).toContainText("Narrated by Kevin R. Free");
  await expect(row).toContainText("3 h 14 min");
  await expect(row).toContainText("The Murderbot Diaries #1");
  await expect(row).toContainText("Narrator matches");
  await expect(detail.locator(".audible-candidate").nth(1)).not.toContainText(
    "Narrator matches",
  );
  expect(searches).toEqual(["audible"]);

  await match.check();
  await detail
    .getByRole("button", { name: /Confirm match|Save and review next/ })
    .click();
  await expect.poll(() => matches.length).toBe(1);
  expect(imports).toEqual(["/api/metadata/books/audible/B06XKBZ6NC/import"]);
  expect(matches[0]).toMatchObject({
    work_id: "00000000-0000-0000-0000-000000000099",
    expected_revision: "rev-1",
  });
});
