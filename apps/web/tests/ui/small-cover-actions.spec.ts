import { expect, test, type Page, type TestInfo } from "../fixtures";

// UX-44: actions for small covers. A: in rows (a series' Books in order, search results, Following)
// the cover column's five actions sit at the end and the rest of the row opens the Summary. B: small
// tiles (series gaps, calendar day cards) get one More button with the actions in words.

const titles = ["Twilight", "New Moon", "Eclipse"];
const work = (title: string, i: number) => ({
  id: `work-${i}`,
  title,
  authors: ["Stephenie Meyer"],
  versions: [],
  cover_url: `https://example.com/${i}.jpg`,
  description: `${title} is a book for the tests.`,
  availability: {
    owned: i === 0,
    ebook: i === 0,
    audio: false,
    stale: false,
  },
});

function today(day: number) {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function mockApi(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().resourceType() === "image") return route.fallback();
    let data: unknown = [];
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          role: "admin",
          username: "reader",
          display_name: "Reader",
          onboarding_status: "complete",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/metadata/account")
      data = { enabled: true, suggest_series_gaps: true };
    else if (path === "/api/acquisition/preferences/personal")
      data = { effective: { desired_media: "both" } };
    else if (path.includes("/quick-add/latest/")) data = null;
    else if (path === "/api/library/libraries") data = [];
    else if (path.startsWith("/api/catalog/works/"))
      data = work("Breaking Dawn", 3);
    else if (path === "/api/catalog/series/hardcover/5451")
      data = {
        external_id: "5451",
        name: "The Twilight Saga",
        authors: ["Stephenie Meyer"],
        projection_version: 2,
        generation: 1,
        fetched_at: "2026-09-28T00:00:00Z",
        status: "completed",
        message: "",
        books: 3,
        total: 3,
        raw_total: 3,
        supplements: 0,
        planned: 0,
        owned: 1,
        ebook: 1,
        audio: 0,
        items: titles.map((title, i) => ({
          membership_id: `member-${i}`,
          external_id: String(i),
          position: String(i + 1),
          publication: "published",
          category: "main",
          compilation: false,
          partial: false,
          merged_record: false,
          ambiguous_position: false,
          work: work(title, i),
        })),
      };
    else if (path.endsWith("/main-books")) data = null;
    else if (path === "/api/discovery/series")
      data = {
        items: [
          {
            external_id: "5451",
            name: "The Twilight Saga",
            fetched_at: "2026-09-20T00:00:00Z",
            catalog_stale: false,
            inventory_stale: false,
            owned: 1,
            ebook: 1,
            audio: 0,
            published: 3,
            missing: 2,
            unknown_publication: 0,
            future_publication: 0,
            unseen: 0,
            books: titles.slice(1).map((title, i) => ({
              position: String(i + 2),
              ambiguous_position: false,
              unseen: false,
              work: work(title, i + 1),
            })),
          },
        ],
        page: 1,
        medium: "any",
        has_more: false,
        suggestions_enabled: true,
        hardcover_connected: true,
        monitored_series: 1,
      };
    else if (path === "/api/releases/calendar")
      data = {
        month: url.searchParams.get("month"),
        genres: [],
        choices: [],
        items: [
          {
            work_id: "work-3",
            provider: "hardcover",
            external_id: "99",
            title: "Breaking Dawn",
            authors: ["Stephenie Meyer"],
            cover_url: "https://example.com/3.jpg",
            release_date: today(15),
            basis: "audiobook",
            followed: false,
            in_library: false,
            genres: [],
            state: null,
          },
        ],
        undated: [],
        page: 1,
        has_more: false,
      };
    return route.fulfill({ json: data });
  });
  return errors;
}

async function shots(page: Page, info: TestInfo, name: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(
      (value) =>
        localStorage.setItem(
          "book-search:display:v1",
          JSON.stringify({ theme: value }),
        ),
      theme,
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width > 400 ? 900 : 844 });
      await page.reload();
      await page.locator(".book-row, .cover-card").first().waitFor();
      await page.screenshot({
        path: info.outputPath(`${name}-${theme}-${width}.png`),
        fullPage: width < 400,
      });
    }
  }
  await page.evaluate(() => localStorage.removeItem("book-search:display:v1"));
}

test("a series' Books in order rows have the cover actions at the end and open the Summary", async ({
  page,
}, info) => {
  const errors = await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/series/hardcover/5451");
  const open = page.getByRole("button", { name: "Twilight, details" });
  await open.focus();
  const order: string[] = [];
  for (let step = 0; step < 5; step++) {
    await page.keyboard.press("Tab");
    order.push(
      await page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") || "",
      ),
    );
  }
  // The same names and order as the cover column, with the tick for a format in the library.
  expect(order).toEqual([
    "Details of Twilight",
    "Ebook of Twilight in library",
    "Get the audiobook of Twilight",
    "Add Twilight to a list",
    "More for Twilight",
  ]);
  const row = page.locator(".book-row").filter({ has: open });
  await expect(
    row
      .getByRole("button", { name: "Ebook of Twilight in library" })
      .locator(".cover-actions__tick"),
  ).toHaveCount(1);
  // The hover label shows on keyboard focus, above the icon.
  const more = row.getByRole("button", { name: "More for Twilight" });
  await expect(more.locator(".cover-actions__tip")).toHaveCSS("opacity", "1");
  for (const box of await row
    .locator(".cover-actions__btn")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect()),
    )) {
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  }
  // At the end of the row, after the title.
  const title = (await row.locator(".book-row__title").boundingBox())!;
  const actions = (await row.locator(".cover-actions").boundingBox())!;
  expect(actions.x).toBeGreaterThan(title.x + title.width - 1);

  // Pressing the title (or anywhere else on the row) opens the Summary.
  // The title lets presses through to the row (force skips the check that it is on top).
  await row.locator(".book-row__title").click({ force: true });
  const summary = page.getByRole("dialog", { name: /Summary/ });
  await expect(summary.getByRole("heading", { name: "Twilight" })).toBeVisible();
  await summary.getByRole("button", { name: "Close summary" }).click();
  await expect(summary).toBeHidden();

  // More holds the book page.
  await more.click();
  const menu = page.getByRole("menu", { name: "More for Twilight" });
  await expect(
    menu.getByRole("menuitem", { name: "Open the book page" }),
  ).toHaveAttribute("href", "/books/work-0");
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();

  // On phones the icons go under the title, and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  const small = (await row.locator(".book-row__title").boundingBox())!;
  const under = (await row.locator(".cover-actions").boundingBox())!;
  expect(under.y).toBeGreaterThan(small.y + small.height - 1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await shots(page, info, "series-rows");
  expect(errors).toEqual([]);
});

test("a series gap tile has one More button with the actions in words", async ({
  page,
}, info) => {
  const errors = await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/discover/series");
  const tile = page
    .locator(".cover-card")
    .filter({ has: page.getByRole("button", { name: "New Moon, details" }) });
  const more = tile.getByRole("button", { name: "More for New Moon" });
  const box = (await more.boundingBox())!;
  expect(Math.round(box.width)).toBe(44);
  expect(Math.round(box.height)).toBe(44);
  await more.click();
  const menu = page.getByRole("menu", { name: "More for New Moon" });
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "View details",
    "Get the ebook",
    "Get the audiobook",
    "Add to a list",
    "Open the book page",
    "Get both formats",
    /^Quick add/,
  ]);
  await menu.getByRole("menuitem", { name: "View details" }).click();
  const summary = page.getByRole("dialog", { name: /Summary/ });
  await expect(summary.getByRole("heading", { name: "New Moon" })).toBeVisible();
  await summary.getByRole("button", { name: "Close summary" }).click();
  // The cover itself opens the Summary too.
  await tile.getByRole("button", { name: "New Moon, details" }).click();
  await expect(summary.getByRole("heading", { name: "New Moon" })).toBeVisible();
  await summary.getByRole("button", { name: "Close summary" }).click();
  await shots(page, info, "series-gaps");
  expect(errors).toEqual([]);
});

test("a calendar day card opens the Summary and has More on its corner", async ({
  page,
}, info) => {
  const errors = await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/discover?view=calendar");
  await page.locator("button.release-day").first().click();
  const card = page.locator(".release-day-card");
  const more = card.getByRole("button", { name: "More for Breaking Dawn" });
  await expect(more).toBeVisible();
  const corner = (await more.boundingBox())!;
  const outer = (await card.boundingBox())!;
  expect(corner.x + corner.width).toBeGreaterThan(outer.x + outer.width - 12);
  expect(corner.y).toBeLessThan(outer.y + 12);
  await expect(more).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath("calendar-day-light-1440.png") });
  await more.click();
  const menu = page.getByRole("menu", { name: "More for Breaking Dawn" });
  await expect(
    menu.getByRole("menuitem", { name: "Open the book page" }),
  ).toHaveAttribute("href", "/books/work-3");
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: "Breaking Dawn, details" }).click();
  // The Summary reads the catalog work from its id.
  const summary = page.getByRole("dialog", { name: /Summary/ });
  await expect(
    summary.getByRole("heading", { name: "Breaking Dawn" }),
  ).toBeVisible();
  await expect(summary).toContainText("Breaking Dawn is a book for the tests.");
  expect(errors).toEqual([]);
});
