import { expect, test, type Page } from "../fixtures";

// SidePanel (components/SidePanel.tsx): the shared library's slide-out, used by the Summary, the
// Following book drawer, the calendar day and the phone menu.

const list = "00000000-0000-0000-0000-0000000000a1";
const work = {
  id: "00000000-0000-0000-0000-000000000123",
  title: "The Giver of Stars",
  authors: ["Jojo Moyes"],
  description:
    "Alice Wright marries handsome American Bennett Van Cleve hoping to escape her stifling life in England.",
  publication_year: 2019,
  availability: {
    owned: true,
    ebook: false,
    audio: true,
    stale: false,
    primary_audio_narrators: ["Julia Whelan"],
  },
};
const followBook = (n: number, title: string, kind: string, label: string) => ({
  work_id: `00000000-0000-0000-0000-00000000010${n}`,
  observation_id: `00000000-0000-0000-0000-00000000020${n}`,
  external_id: String(n),
  title,
  authors: ["Barry J. Hutchison"],
  cover_url: null,
  release_date: "2020-01-0" + n,
  upcoming: false,
  included: true,
  ebook: false,
  audio: kind === "in_library",
  stale: false,
  follow_names: ["Space Team"],
  status: { kind, label, detail: kind === "wanted" ? "Added by hand" : null },
});
function release(title: string, author: string) {
  const today = new Date();
  return {
    work_id: null,
    provider: "hardcover",
    external_id: title,
    title,
    authors: [author],
    cover_url: "/assets/storyarr-192.png",
    release_date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`,
    basis: "audiobook",
    followed: false,
    in_library: false,
    genres: ["fantasy"],
    state: null,
  };
}

async function mock(
  page: Page,
  theme: "light" | "dark" = "light",
  role = "member",
) {
  await page.addInitScript(
    (value) =>
      localStorage.setItem(
        "book-search:display:v1",
        JSON.stringify({ layout: "shelf", theme: value }),
      ),
    theme,
  );
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let data: unknown = { items: [], total: 0, offset: 0, limit: 40 };
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          role,
          username: "reader",
          display_name: "Reader",
          permissions: [],
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/library/libraries") data = [];
    else if (path === "/api/application/release")
      data = {
        installed_version: "v0.4.8",
        installed_url: null,
        latest_version: "v0.4.8",
        release_url: null,
        update_available: false,
        status: "checked",
      };
    else if (path.includes("/acquisition/preferences/"))
      data = { effective: { desired_media: "audio" } };
    else if (["/api/catalog/works", "/api/library/books"].includes(path))
      data = { items: [work], total: 1, offset: 0, limit: 40 };
    else if (path === `/api/metadata/works/${work.id}`)
      data = {
        sources: [
          {
            provider: "hardcover",
            external_id: "hc-giver",
            series: [
              { external_id: "hc-series", name: "Kentucky", position: 1 },
            ],
          },
        ],
      };
    else if (path === "/api/metadata/books/hardcover/hc-giver/reader-details")
      data = {
        authors: [{ external_id: "hc-moyes", name: "Jojo Moyes" }],
        audio_seconds: 47_000,
        rating: 4.1,
        ratings_count: 2310,
      };
    else if (path === `/api/following/${list}/summary`)
      data = {
        list_id: list,
        source_kind: "series",
        external_id: "77",
        name: "Space Team",
        image_url: null,
        followed_at: "2026-10-01T00:00:00Z",
        enabled: true,
        state: "succeeded",
        complete: true,
        last_success_at: "2026-10-30T00:00:00Z",
        mode: "automatic",
        active: true,
        latest_books: [],
      };
    else if (path === `/api/following/${list}/books`)
      data = {
        items: [
          followBook(1, "Space Team", "in_library", "In library"),
          followBook(3, "The Hunt for Reduk Topa", "wanted", "Wanted"),
        ],
        total: 2,
        offset: 0,
        limit: 48,
        status_counts: { in_library: 1, wanted: 1 },
      };
    else if (path === "/api/releases/calendar")
      data = {
        month: url.searchParams.get("month"),
        genres: ["fantasy"],
        choices: ["fantasy"],
        items: [
          release("The Lantern Road", "Ann Author"),
          release("A Harbour of Glass", "Ben Writer"),
        ],
        undated: [],
        page: 1,
        has_more: false,
      };
    return route.fulfill({ json: data });
  });
}

test("a slide-out takes focus, keeps Tab inside and gives focus back when it closes", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/library");
  const cover = page.locator(".shelf-book").first();
  await cover.click();
  const panel = page.getByRole("dialog", {
    name: "Summary The Giver of Stars",
  });
  await expect(panel).toHaveAttribute("aria-modal", "true");
  const close = panel.getByRole("button", { name: "Close summary" });
  await expect(close).toBeFocused();
  // The page behind cannot scroll.
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(
    "hidden",
  );

  // Tab goes round the panel and never reaches the page behind.
  const inside = () =>
    page.evaluate(
      () =>
        !!document.activeElement?.closest(".side-panel") &&
        document.activeElement !== document.body,
    );
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Tab");
    expect(await inside()).toBe(true);
  }
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  expect(await inside()).toBe(true);
  await expect(close).not.toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  // Escape closes it and puts focus back on the cover that opened it.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(cover).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

  // The calendar day returns focus to its day, too.
  await page.goto("/discover?view=calendar");
  const day = page.locator("button.release-day").first();
  await day.click();
  const dayPanel = page.locator("#release-day-panel");
  await expect(dayPanel).toHaveAttribute("role", "dialog");
  await expect(
    dayPanel.getByRole("button", { name: "Close day" }),
  ).toBeFocused();
  await expect(dayPanel.getByText("2 releases")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dayPanel).toHaveCount(0);
  await expect(day).toBeFocused();
});

for (const theme of ["light", "dark"] as const) {
  test(`slide-outs look like the library's in ${theme}`, async ({
    page,
  }, testInfo) => {
    await mock(page, theme, "admin");
    const shoot = async (name: string) => {
      await page.waitForTimeout(350); // Let the slide finish.
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${theme}.png`),
      });
    };
    for (const [size, width] of [
      ["desktop", 1280],
      ["phone", 390],
    ] as const) {
      await page.setViewportSize({ width, height: 844 });

      await page.goto("/library");
      await page.locator(".shelf-book").first().click();
      await expect(
        page.getByRole("dialog", { name: /Summary/ }).getByText("Julia Whelan"),
      ).toBeVisible();
      await shoot(`summary-${size}`);
      await page.keyboard.press("Escape");

      await page.goto(`/following/${list}`);
      await page
        .getByRole("button", { name: "The Hunt for Reduk Topa, Wanted" })
        .click();
      await expect(
        page.getByRole("dialog", { name: /The Hunt for Reduk Topa/ }),
      ).toBeVisible();
      await shoot(`follow-book-${size}`);
      await page.keyboard.press("Escape");

      await page.goto("/discover?view=calendar");
      await page.locator("button.release-day").first().click();
      await expect(page.locator("#release-day-panel")).toBeVisible();
      await shoot(`calendar-day-${size}`);
      await page.keyboard.press("Escape");

      if (size === "phone") {
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        await expect(
          page.getByRole("dialog", { name: "Main menu" }),
        ).toBeVisible();
        await shoot("phone-menu");
        await page.keyboard.press("Escape");
      }
    }
  });
}
