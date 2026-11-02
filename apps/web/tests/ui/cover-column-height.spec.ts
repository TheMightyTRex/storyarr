import { expect, test, type Page } from "../fixtures";

// David, 2 November 2026: on In my libraries the action column must be exactly the height of the cover,
// as on author pages, for a portrait ebook cover and a square audiobook cover, at every Cover size; and
// the covers there are 10% larger than they were (113, 167 and 238px wide at 1440px).

const art = (width: number, height: number, fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`)}`;
const portrait = art(200, 300, "#2b4f6e");
const square = art(300, 300, "#7a2e3b");
const titles = ["The Salt Road", "Half a Lantern", "Glass Harbour", "Moth Hour"];

async function mockApi(page: Page, size: string) {
  // Even books are ebooks with a portrait cover; odd books are audiobooks with a square cover.
  const works = titles.map((title, index) => ({
    id: `00000000-0000-0000-0000-00000000050${index}`,
    title,
    authors: ["Mara Ellison"],
    cover_url: index % 2 ? square : portrait,
    availability: {
      owned: true,
      ebook: !(index % 2),
      audio: !!(index % 2),
      stale: false,
    },
  }));
  const books = works.map((work, index) => ({
    provider: "hardcover",
    external_id: String(101 + index),
    title: work.title,
    authors: work.authors,
    publication_year: 2001 + index,
    cover_url: work.cover_url,
  }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { items: [], total: 0, offset: 0, limit: 40 };
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          role: "member",
          username: "reader",
          display_name: "Reader",
          permissions: [],
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (
      [
        "/api/library/libraries",
        "/api/lists",
        "/api/following",
        "/api/acquisition/profiles",
      ].includes(path)
    )
      data = [];
    else if (path === "/api/preferences")
      data = {
        collection_view: "detail",
        library_views: {},
        cover_size: size,
        cover_actions: "on",
      };
    else if (path === "/api/library/books")
      data = { items: works, total: works.length, offset: 0, limit: 40 };
    else if (path === "/api/metadata/authors/hardcover/9")
      data = {
        author: {
          external_id: "9",
          name: "Mara Ellison",
          slug: "mara-ellison",
          bio: "",
          image_url: null,
        },
        books,
        page: 1,
        has_more: false,
        known_works: {},
      };
    else if (path.endsWith("/cover")) return route.fulfill({ status: 404 });
    else if (path.includes("/acquisition/preferences/"))
      data = { effective: { desired_media: "both" } };
    else if (path.includes("/quick-add/latest/")) data = null;
    return route.fulfill({ json: data });
  });
}

/** Points at each of the first two covers (portrait ebook, square audiobook) and measures both boxes. */
async function columnsMatchCovers(page: Page, cards: string) {
  const widths: number[] = [];
  for (const index of [0, 1]) {
    const card = page.locator(cards).nth(index);
    await expect(card.locator(".book-cover img")).toBeVisible();
    await card.hover();
    const actions = card.locator(".cover-actions");
    await expect(actions).toHaveCSS("opacity", "1");
    const cover = (await card.locator(".book-cover").boundingBox())!;
    const image = (await card.locator(".book-cover img").boundingBox())!;
    const column = (await actions.boundingBox())!;
    // The image fills the cover, and the column's top and bottom edges match it.
    expect(Math.abs(image.y - cover.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(image.height - cover.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(column.y - cover.y)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(column.y + column.height - (cover.y + cover.height)),
    ).toBeLessThanOrEqual(1);
    // On the cover's right edge, and every action is 24px or taller.
    expect(
      Math.abs(column.x + column.width - (cover.x + cover.width)),
    ).toBeLessThanOrEqual(1);
    for (const button of await actions
      .locator(".cover-actions__btn")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().height),
      ))
      expect(button).toBeGreaterThanOrEqual(24);
    widths.push(Math.round(cover.width));
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  return widths;
}

const sizes = [
  ["small", 124],
  ["medium", 184],
  ["large", 260],
] as const;

for (const [size, width] of sizes)
  test(`the action column is the height of the cover on In my libraries and an author page (${size} covers)`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockApi(page, size);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto("/library");
    await expect(page.locator(".shelf-wall")).toHaveAttribute(
      "data-size",
      size,
    );
    // 10% larger than before, and every cover the same width so they line up.
    expect(await columnsMatchCovers(page, ".shelf-wall .cover-card")).toEqual([
      width,
      width,
    ]);
    const tops = await page
      .locator(".shelf-wall .cover-card__art")
      .evaluateAll((nodes) =>
        nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
      );
    expect(new Set(tops).size).toBe(1);

    await page.goto("/authors/hardcover/9");
    await columnsMatchCovers(page, ".entity-book-grid .cover-card");

    // Phones: no sideways scroll, and the column still matches.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/library");
    await columnsMatchCovers(page, ".shelf-wall .cover-card");
    await page.goto("/authors/hardcover/9");
    await columnsMatchCovers(page, ".entity-book-grid .cover-card");
    expect(errors).toEqual([]);
  });

test("the action column matches square cover frames too", async ({ page }) => {
  // Display, Cover shape: square for audiobooks and the default, so the frame itself is square.
  await page.addInitScript(() =>
    localStorage.setItem(
      "book-search:display:v1",
      JSON.stringify({ audioShape: "square", defaultShape: "square" }),
    ),
  );
  await mockApi(page, "small");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/library?medium=audio");
    await expect(page.locator(".shelf-wall .book-cover").first()).toHaveClass(
      /cover-square/,
    );
    await columnsMatchCovers(page, ".shelf-wall .cover-card");
    await page.goto("/authors/hardcover/9");
    await expect(
      page.locator(".entity-book-grid .book-cover").first(),
    ).toHaveClass(/cover-square/);
    await columnsMatchCovers(page, ".entity-book-grid .cover-card");
  }
});
