import { expect, test, emptyDiscoveryHome, type Page } from "../fixtures";

// UX-42 cover actions and UX-30 shelves: the column's keyboard order and names, the cover opening the
// Summary, the per-account layout setting, and the shelf arrows.

const art = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="${fill}"/></svg>`)}`;
const titles = [
  "The Salt Road",
  "The Cartographer's Daughter and the Long Winter Crossing of the Northern Sea",
  "Half a Lantern",
  "Beneath the Weir",
  "Sleeping Lanterns",
  "Glass Harbour",
  "North of Quiet",
  "A Map of Lost Things",
  "The Paper Orchard",
  "Winter Lines",
  "The Quiet Engine",
  "Moth Hour",
  "The Last Ferry",
  "Under Juniper",
  "Starling Season",
  "Rivermouth",
];

async function mockApi(
  page: Page,
  preferences: Record<string, unknown>,
  saved: unknown[],
) {
  const items = titles.map((title, index) => ({
    book: {
      provider: "hardcover",
      external_id: `book-${index}`,
      title,
      authors: ["Mara Ellison"],
      cover_url: art(index % 2 ? "#7a2e3b" : "#2b4f6e"),
    },
    work: {
      id: `work-${index}`,
      title,
      authors: ["Mara Ellison"],
      cover_url: art(index % 2 ? "#7a2e3b" : "#2b4f6e"),
      description: `${title} is a book for the tests.`,
      availability: { owned: index === 0, ebook: index === 0, audio: false },
    },
  }));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/discovery/home")
      return route.fulfill({ json: emptyDiscoveryHome() });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          username: "reader",
          display_name: "Reader",
          role: "admin",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/metadata/account") data = { enabled: true };
    else if (path.endsWith("/cover")) return route.fulfill({ status: 404 });
    else if (path === "/api/preferences") {
      if (request.method() === "PATCH") {
        saved.push(request.postDataJSON());
        Object.assign(preferences, request.postDataJSON());
      }
      data = preferences;
    } else if (path === "/api/discovery/hardcover/trending")
      data = { title: "Trending on Hardcover", status: "ready", items };
    else if (path.startsWith("/api/discovery/"))
      data = { title: "Other books", status: "ready", items: [], total: 0 };
    else if (path === "/api/acquisition/preferences/personal")
      data = { effective: { desired_media: "both" } };
    else if (path.includes("/quick-add/latest/")) data = null;
    return route.fulfill({ json: data });
  });
}

const base = () => ({
  collection_view: "detail",
  library_views: {},
  cover_size: "medium",
  cover_actions: "on",
});

test("a cover's actions come in order with full names, and the cover opens the Summary", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockApi(page, base(), []);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/discover");
  const open = page.getByRole("button", {
    name: "The Salt Road, details",
    exact: true,
  });
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
  expect(order).toEqual([
    "Details of The Salt Road",
    "Ebook of The Salt Road in library",
    "Get the audiobook of The Salt Road",
    "Add The Salt Road to a list",
    "More for The Salt Road",
  ]);
  const card = page.locator(".cover-card").filter({ has: open });
  // The hover label also shows on keyboard focus, and every action is a 44px target.
  const more = card.getByRole("button", { name: "More for The Salt Road" });
  await expect(more.locator(".cover-actions__tip")).toHaveCSS("opacity", "1");
  await expect(more.locator(".cover-actions__tip")).toHaveText("More");
  for (const box of await card
    .locator(".cover-actions__btn")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect()),
    )) {
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  }
  // The tick and the words say the ebook is in the library, not colour alone.
  await expect(
    card
      .getByRole("button", { name: "Ebook of The Salt Road in library" })
      .locator(".cover-actions__tick"),
  ).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("keyboard.png") });

  // Pressing the cover opens the Summary; so does the title.
  await page.mouse.click(
    ...(await card
      .locator(".book-cover")
      .boundingBox()
      .then((box) => [box!.x + 20, box!.y + box!.height / 2] as const)),
  );
  const summary = page.getByRole("dialog", { name: /Summary/ });
  await expect(summary).toBeVisible();
  await expect(
    summary.getByRole("heading", { name: "The Salt Road" }),
  ).toBeVisible();
  await expect(
    summary.getByRole("link", { name: "Open book page" }),
  ).toHaveAttribute("href", "/books/work-0");
  await summary.getByRole("button", { name: "Close summary" }).click();
  await expect(summary).toBeHidden();
  await expect(open).toBeFocused();
  const long = page.locator(".cover-card").nth(1);
  // The cover's button stretches over the title, so pressing the title opens the Summary too.
  const heading = (await long.locator(".media-card__title").boundingBox())!;
  await page.mouse.click(heading.x + 10, heading.y + heading.height / 2);
  await expect(summary).toBeVisible();
  await expect(
    summary.getByRole("heading", { name: /Cartographer/ }),
  ).toBeVisible();
  await summary.getByRole("button", { name: "Close summary" }).click();

  // Details does the same; More holds the book page.
  await card.hover();
  await card.getByRole("button", { name: "Details of The Salt Road" }).click();
  await expect(summary).toBeVisible();
  await summary.getByRole("button", { name: "Close summary" }).click();
  await card.hover();
  await more.click();
  const menu = page.getByRole("menu", { name: "More for The Salt Road" });
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await expect(
    menu.getByRole("menuitem", { name: "Open the book page" }),
  ).toHaveAttribute("href", "/books/work-0");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  // Covers line up: a two-line or longer title never changes a cover's size or place.
  const arts = await page.locator(".cover-card__art").evaluateAll((nodes) =>
    nodes.slice(0, 4).map((node) => {
      const box = node.getBoundingClientRect();
      return [Math.round(box.top), Math.round(box.height)];
    }),
  );
  expect(new Set(arts.map(String)).size).toBe(1);
  expect(errors).toEqual([]);
});

test("the cover actions layout is saved with the account and switches the covers", async ({
  page,
}, testInfo) => {
  const preferences = base();
  const saved: unknown[] = [];
  await mockApi(page, preferences, saved);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings#display");
  const setting = page.getByRole("group", { name: "Cover actions" });
  await expect(
    setting.getByRole("radio", { name: /On the cover/ }),
  ).toBeChecked();
  // A small working example of each layout, two covers each, kept out of the Tab order.
  await expect(setting.locator(".cover-actions-example")).toHaveCount(2);
  await expect(
    setting.locator(".cover-actions-example .cover-card"),
  ).toHaveCount(4);
  await expect(
    setting.locator('.cover-actions-example [tabindex="-1"]'),
  ).not.toHaveCount(0);
  await setting.getByRole("radio", { name: /Beside the cover/ }).check();
  await expect.poll(() => saved).toEqual([{ cover_actions: "beside" }]);
  await setting.screenshot({ path: testInfo.outputPath("setting.png") });

  await page.goto("/discover");
  const card = page.locator(".cover-card").first();
  await expect(card).toHaveAttribute("data-actions", "beside");
  // Beside the cover: always shown, and next to the art rather than over it.
  await expect(card.locator(".cover-actions")).toHaveCSS("opacity", "1");
  const cover = (await card.locator(".book-cover").boundingBox())!;
  const column = (await card.locator(".cover-actions").boundingBox())!;
  expect(column.x).toBeGreaterThanOrEqual(cover.x + cover.width - 1);

  preferences.cover_actions = "on";
  await page.reload();
  await expect(card).toHaveAttribute("data-actions", "on");
  await expect(card.locator(".cover-actions")).toHaveCSS("opacity", "0");
});

test("shelf arrows show only when there are more books that way, and move the shelf", async ({
  page,
}, testInfo) => {
  await mockApi(page, base(), []);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/discover");
  const back = page.getByRole("button", {
    name: "Earlier books in Trending on Hardcover",
  });
  const forward = page.getByRole("button", {
    name: "More books in Trending on Hardcover",
  });
  const track = page.getByRole("list", { name: "Trending on Hardcover" });
  await expect(forward).toBeVisible();
  await expect(back).toBeHidden();
  await expect(track).toHaveCSS("scrollbar-width", "none");
  // The arrow sits in the middle of the covers.
  const cover = (await track.locator(".book-cover").first().boundingBox())!;
  const arrow = (await forward.boundingBox())!;
  expect(
    Math.abs(arrow.y + arrow.height / 2 - (cover.y + cover.height / 2)),
  ).toBeLessThan(3);
  await page.screenshot({ path: testInfo.outputPath("shelf-start.png") });
  // One press moves one screen less one cover.
  const { width, step } = await track.evaluate((list) => {
    const first = list.firstElementChild!.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(list).columnGap);
    return { width: list.clientWidth, step: list.clientWidth - first - gap };
  });
  expect(width).toBeGreaterThan(0);
  await forward.click();
  await expect
    .poll(() => track.evaluate((list) => list.scrollLeft))
    .toBeGreaterThan(step - 4);
  await expect(back).toBeVisible();
  await back.click();
  await expect.poll(() => track.evaluate((list) => list.scrollLeft)).toBe(0);
  await expect(back).toBeHidden();

  // With reduce motion the shelf jumps straight there.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await forward.click();
  expect(await track.evaluate((list) => list.scrollLeft)).toBeGreaterThan(
    step - 4,
  );
  await track.evaluate((list) => (list.scrollLeft = 0));

  // Tabbing to a book scrolls it fully into view, clear of the fade.
  const tenth = page.getByRole("button", {
    name: `${titles[9]}, details`,
    exact: true,
  });
  await tenth.focus();
  const list = (await track.boundingBox())!;
  const book = (await tenth.boundingBox())!;
  expect(book.x).toBeGreaterThanOrEqual(list.x);
  expect(book.x + book.width).toBeLessThanOrEqual(list.x + list.width - 40);

  // At the end the forward arrow goes.
  await track.evaluate((list) =>
    list.scrollTo({ left: list.scrollWidth, behavior: "instant" }),
  );
  await expect(forward).toBeHidden();

  // On phones: no arrows, the fade alone says there is more.
  await track.evaluate((list) => (list.scrollLeft = 0));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(forward).toBeHidden();
  await expect(page.locator(".shelf-edge--end").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("shelf-phone.png") });
});
