import { expect, test } from "../fixtures";

const works = ["A Wizard of Earthsea", "The Tombs of Atuan"].map(
  (title, i) => ({
    id: `book-${i}`,
    title,
    authors: ["Ursula Le Guin"],
    availability: { owned: true, ebook: true, audio: false, stale: false },
  }),
);
test("My Library browses owned authors and series, filters, and opens books", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    let data: unknown = {};
    if (url.pathname === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          role: "viewer",
          username: "reader",
          display_name: "Reader",
        },
        csrf_token: "test",
      };
    else if (url.pathname === "/api/setup/onboarding")
      data = { status: "completed" };
    else if (url.pathname === "/api/library/libraries") data = [];
    else if (url.pathname.endsWith("/reader-details"))
      data = {
        external_id: "101",
        authors: [
          {
            external_id: "1",
            name: "Ursula Le Guin",
            image_url: "/portrait.svg",
          },
        ],
      };
    else if (
      url.pathname.includes("/groups/") &&
      url.pathname.endsWith("/books")
    )
      data = { items: works, total: 2, offset: 0, limit: 40 };
    else if (url.pathname.includes("/groups/")) {
      const series = url.pathname.endsWith("/series");
      data = {
        items: url.searchParams.get("q")
          ? []
          : [
              {
                name: series ? "Earthsea" : "Ursula Le Guin",
                key: series ? "earthsea" : "ursula le guin",
                book_count: 2,
                external_id: series ? "7" : null,
                books: works,
                hardcover_book_id: "101",
              },
            ],
        total: url.searchParams.get("q") ? 0 : 1,
        offset: 0,
        limit: 24,
      };
    } else if (url.pathname.endsWith("/cover"))
      return route.fulfill({ status: 404 });
    else if (url.pathname === "/api/library/books")
      data = { items: works, total: 2, offset: 0, limit: 40 };
    if (
      new URL(route.request().url()).pathname.includes(
        "/acquisition/preferences/",
      )
    )
      data = { effective: { desired_media: "both" } };
    return route.fulfill({ json: data });
  });
  await page.route("**/portrait.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="tan"/></svg>',
    }),
  );
  await page.goto("/library");
  const tabs = page.getByRole("navigation", { name: "Library shelves" });
  await tabs.getByRole("link", { name: "Authors", exact: true }).click();
  await expect(
    tabs.getByRole("link", { name: "Authors", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    tabs.getByRole("link", { name: "In my libraries" }),
  ).not.toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Authors in your collection" }),
  ).toBeVisible();
  await expect(page.locator(".library-group-portrait img")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".library-group-portrait img")
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.locator(".library-group-portrait")).toHaveCSS(
    "border-radius",
    "50%",
  );
  await page.screenshot({
    path: testInfo.outputPath("library-authors.png"),
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Ursula Le Guin, 2 books in your collection" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ursula Le Guin", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".book-grid .book-card")).toHaveCount(2);
  await expect(
    page.locator(".book-grid .book-card .book-link-target").first(),
  ).toHaveAttribute("href", "/books/book-0");
  await page.reload();
  await expect(page.locator(".book-grid .book-card")).toHaveCount(2);
  await page.getByRole("link", { name: "All authors", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search authors" }).fill("Nobody");
  await page.getByRole("button", { name: "Search authors" }).click();
  await expect(
    page.getByRole("heading", { name: "No authors to show" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(
    page.getByRole("heading", { name: "Ursula Le Guin", exact: true }),
  ).toBeVisible();
  await tabs.getByRole("link", { name: "Series", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Explore full series" }),
  ).toHaveAttribute("href", "/series/hardcover/7");
  await page
    .getByRole("combobox", { name: "Media", exact: true })
    .selectOption("audio");
  await expect(page).toHaveURL(/medium=audio/);
  await expect(page.locator(".library-group-portrait img")).toBeVisible();
  await expect(
    page.locator(".library-group-covers .book-cover").first(),
  ).toHaveCSS("aspect-ratio", "2 / 3");
  await page
    .locator(".library-group-portrait img")
    .evaluate((img) => img.dispatchEvent(new Event("error")));
  await expect(page.locator(".library-group-portrait svg")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("library-series-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Earthsea, 2 books in your collection" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Earthsea", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Series in your collection" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("library series show follow status, every book and a way to add missing books", async ({
  page,
}) => {
  const series = {
    name: "Earthsea",
    key: "earthsea",
    book_count: 2,
    external_id: "7",
    books: works,
    hardcover_book_id: "101",
  };
  const counts = { in_library: 2, waiting: 1, excluded: 1 };
  const previews: Record<string, unknown>[] = [];
  let activated = false;
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    let data: unknown = {};
    if (url.pathname === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          role: "member",
          username: "reader",
          display_name: "Reader",
        },
        csrf_token: "test",
      };
    else if (url.pathname === "/api/setup/onboarding")
      data = { status: "completed" };
    else if (url.pathname === "/api/library/libraries") data = [];
    else if (url.pathname === "/api/library/groups/series")
      data = { items: [series], total: 1, offset: 0, limit: 24 };
    else if (url.pathname === "/api/following")
      data = [
        {
          list_id: "earthsea-follow",
          name: "Earthsea",
          source_kind: "series",
          external_id: "7",
          filters: {},
          subscription: {
            enabled: true,
            last_success_at: null,
            state: "idle",
            generation: 1,
          },
          mode: "automatic",
          active: true,
        },
      ];
    else if (url.pathname === "/api/following/earthsea-follow/books")
      data = {
        items: [
          {
            work_id: "book-2",
            external_id: "9",
            title: "Tehanu",
            authors: ["Ursula Le Guin"],
            upcoming: false,
            included: true,
            ebook: false,
            audio: false,
            stale: false,
            follow_names: [],
            status: {
              kind: "waiting",
              label: "Waiting",
              detail: "Next automatic search",
            },
          },
        ],
        total: 1,
        offset: 0,
        limit: 12,
        status_counts: counts,
      };
    else if (url.pathname === "/api/automation/settings")
      data = {
        settings: { follow_filters: {}, missing_media: null },
        built_in: { follow_filters: {}, missing_media: null },
        generation: 0,
      };
    else if (url.pathname === "/api/acquisition/preferences/personal")
      data = { effective: { desired_media: "audio" } };
    else if (url.pathname === "/api/lists/earthsea-follow/acquisition")
      data = null;
    else if (
      url.pathname === "/api/lists/earthsea-follow/acquisition/preview"
    ) {
      previews.push(route.request().postDataJSON());
      data = {
        id: "plan-1",
        selected: 4,
        total: 7,
        counts: { owned: 2, missing: 4, excluded: 1 },
        records: [],
      };
    } else if (url.pathname.endsWith("/previews/plan-1/activate")) {
      activated = true;
      data = { id: "policy" };
    } else if (url.pathname.endsWith("/cover"))
      return route.fulfill({ status: 404 });
    return route.fulfill({ json: data });
  });
  await page.goto("/library?view=series");
  const card = page.getByRole("article").filter({ hasText: "Earthsea" });
  await card.getByRole("button", { name: "Add missing books" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Add missing books · Earthsea",
  });
  await expect(
    dialog.getByRole("radio", { name: "Audiobooks", exact: true }),
  ).toBeChecked();
  await dialog.getByRole("radio", { name: "Audiobooks and ebooks" }).check();
  await dialog.getByRole("button", { name: "Find missing books" }).click();
  await expect(
    dialog.getByText("will be searched for automatically"),
  ).toBeVisible();
  expect(previews[0]).toMatchObject({
    mode: "automatic",
    include_missing: true,
    specification: { mode: "both" },
  });
  await dialog.getByRole("button", { name: "Start searching" }).click();
  await expect(dialog.getByText("Searching for 4 missing books")).toBeVisible();
  expect(activated).toBe(true);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(card.getByText("Waiting", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Show every book" }).click();
  await expect(
    card.getByRole("link", { name: "Tehanu", exact: true }),
  ).toBeVisible();
  await expect(card.getByText("Next automatic search")).toBeVisible();
});
