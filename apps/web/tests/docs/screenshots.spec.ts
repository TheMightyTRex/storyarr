import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Documentation screenshots, not a regression test. Every book, author and cover here is invented, so the
// images show the interface without anyone's library or real cover art. Run with:
//   node node_modules/@playwright/test/cli.js test --config=playwright.docs.config.ts
const OUT = "../../docs/images";
const list = "00000000-0000-0000-0000-0000000000a1";
const palette = [
  ["#1f3a5f", "#f2c14e"],
  ["#5b2a3c", "#f4d6c6"],
  ["#23443a", "#e8d7a9"],
  ["#3b2f63", "#f0b67f"],
  ["#6b3a1f", "#f7e3c3"],
  ["#2d4f6b", "#cfe8ef"],
  ["#4a4a2a", "#f1e4b3"],
  ["#5a1f1f", "#f6c9a8"],
  ["#1e4d4a", "#f3d9a4"],
  ["#40304f", "#e6c7e9"],
  ["#2f3e1f", "#e3eccd"],
  ["#4d2b1a", "#f2ceb0"],
];
const titles = [
  "The Lantern Road",
  "Salt and Starlight",
  "The Ninth Lighthouse",
  "A Map of Quiet Places",
  "The Glass Orchard",
  "Embers of Halloway",
  "The Clockmaker's Daughter",
  "Under the Copper Moon",
  "The Last Ferry North",
  "Winter at Greywater",
  "The Paper Kingdom",
  "Letters from the Tideline",
];
const statuses: [string, string, string | null][] = [
  ["in_library", "In library", "Audiobook"],
  ["in_library", "In library", "Audiobook"],
  ["in_library", "In library", "Audiobook and ebook"],
  ["in_library", "In library", "Audiobook"],
  ["downloading", "Downloading 64%", "From MyAnonamouse"],
  ["in_library", "In library", "Audiobook"],
  ["waiting", "Waiting", "Next search in 5 hours"],
  ["in_library", "In library", "Audiobook"],
  ["wanted", "Wanted", "Added by you"],
  ["not_released", "Not released", "Release date 14 March 2027"],
  ["excluded", "Excluded", "Companion book"],
  ["not_requested", "Not requested", null],
];

function cover(index: number) {
  const [background, ink] = palette[index % palette.length];
  const words = titles[index].split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last && (last + " " + word).length <= 12)
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const text = lines
    .map(
      (line, n) =>
        `<text x="100" y="${110 + n * 34}" font-family="Georgia, serif" font-size="26" fill="${ink}" text-anchor="middle">${line}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300">
    <rect width="200" height="300" fill="${background}"/>
    <rect x="12" y="12" width="176" height="276" fill="none" stroke="${ink}" stroke-opacity="0.5"/>
    <circle cx="100" cy="58" r="16" fill="none" stroke="${ink}" stroke-width="2"/>
    ${text}
    <text x="100" y="226" font-family="Helvetica, sans-serif" font-size="13" letter-spacing="2" fill="${ink}" text-anchor="middle">MARA ELLISON</text>
  </svg>`;
}

function book(index: number) {
  const [kind, label, detail] = statuses[index];
  return {
    work_id: `00000000-0000-0000-0000-0000000001${String(index).padStart(2, "0")}`,
    observation_id: `00000000-0000-0000-0000-0000000002${String(index).padStart(2, "0")}`,
    external_id: String(1000 + index),
    title: titles[index],
    authors: ["Mara Ellison"],
    cover_url: `/demo-covers/${index}.svg`,
    release_date: `${2016 + index}-0${(index % 9) + 1}-12`,
    upcoming: kind === "not_released",
    included: kind !== "excluded",
    ebook: index === 2,
    audio: kind === "in_library",
    stale: false,
    follow_names: ["The Lantern Road"],
    status: {
      kind,
      label,
      detail,
      at: null,
      progress: kind === "downloading" ? 64 : null,
    },
  };
}

const admin = {
  user: {
    id: "reader",
    role: "admin",
    username: "alex",
    display_name: "Alex",
    permissions: [],
  },
  csrf_token: "docs",
};

function libraryWork(index: number) {
  return {
    id: `00000000-0000-0000-0000-0000000003${String(index).padStart(2, "0")}`,
    title: titles[index],
    authors: ["Mara Ellison"],
    cover_url: `/demo-covers/${index}.svg`,
    publication_year: 2016 + index,
    description:
      index === 6
        ? "A clockmaker's daughter keeps her father's shop running while she tracks down the missing gears of a clock that predicts storms."
        : null,
    availability: {
      owned: true,
      ebook: index % 3 === 0,
      audio: index % 4 !== 3,
      stale: false,
      primary_audio_narrators: ["Imogen Hale"],
    },
  };
}

async function setup(
  page: Page,
  theme: "light" | "dark" = "light",
  upgrading = false,
  newerRelease = false,
) {
  await page.addInitScript((value) => {
    localStorage.setItem(
      "book-search:display:v1",
      JSON.stringify({ layout: "shelf", theme: value }),
    );
  }, theme);
  await page.route("**/demo-covers/*.svg", (route) => {
    const index = Number(
      route
        .request()
        .url()
        .match(/(\d+)\.svg$/)?.[1] ?? 0,
    );
    return route.fulfill({ contentType: "image/svg+xml", body: cover(index) });
  });
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let data: unknown = { items: [], total: 0, offset: 0, limit: 40 };
    if (path === "/api/auth/me") data = admin;
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/library/libraries") data = [];
    else if (path === "/api/application/release")
      data = {
        installed_version: "v0.4.8",
        installed_url: null,
        latest_version: newerRelease ? "v0.4.9" : "v0.4.8",
        release_url: null,
        update_available: newerRelease,
        status: "checked",
      };
    else if (path === "/api/library/books" || path === "/api/catalog/works")
      data = {
        items: titles.map((_, index) => libraryWork(index)),
        total: titles.length,
        offset: 0,
        limit: 40,
      };
    else if (path.startsWith("/api/metadata/works/"))
      data = {
        sources: [
          {
            provider: "hardcover",
            external_id: "docs-map",
            series: [
              { external_id: "77", name: "The Lantern Road", position: 7 },
            ],
          },
        ],
      };
    else if (path.endsWith("/reader-details"))
      data = {
        authors: [{ external_id: "501", name: "Mara Ellison" }],
        rating: 4.3,
        ratings_count: 1287,
        release_date: "2019-04-12",
        audio_seconds: 41340,
      };
    else if (path === "/api/acquisition/preferences/personal")
      data = { effective: { desired_media: "audio" } };
    else if (path === `/api/following/${list}/summary`)
      data = {
        list_id: list,
        source_kind: "series",
        external_id: "77",
        name: "The Lantern Road",
        image_url: null,
        followed_at: "2026-09-01T00:00:00Z",
        enabled: true,
        state: "succeeded",
        complete: true,
        last_success_at: "2026-10-30T00:00:00Z",
        mode: "automatic",
        active: true,
        latest_books: [],
      };
    else if (path === `/api/following/${list}/books`) {
      const status = url.searchParams.get("status");
      const items = titles
        .map((_, index) => book(index))
        .filter((item) => !status || item.status.kind === status);
      const counts: Record<string, number> = {};
      for (const item of titles.map((_, index) => book(index)))
        counts[item.status.kind] = (counts[item.status.kind] ?? 0) + 1;
      data = {
        items,
        total: items.length,
        offset: 0,
        limit: 48,
        status_counts: counts,
      };
    } else if (path === "/api/releases/calendar") {
      const month = url.searchParams.get("month") ?? "2026-11";
      const days = [3, 5, 5, 11, 12, 18, 19, 19, 24, 26];
      data = {
        month,
        genres: ["fantasy", "mystery"],
        choices: ["fantasy", "mystery", "science-fiction", "romance"],
        items: days.map((day, index) => ({
          work_id: null,
          provider: "hardcover",
          external_id: `cal-${index}`,
          title: titles[(index + 3) % titles.length],
          authors: [["Mara Ellison", "Tobias Wren", "June Okafor"][index % 3]],
          cover_url: `/demo-covers/${(index + 3) % titles.length}.svg`,
          release_date: `${month}-${String(day).padStart(2, "0")}`,
          basis: "audiobook",
          followed: index % 4 === 0,
          in_library: false,
          genres: [index % 2 ? "mystery" : "fantasy"],
          state: null,
        })),
        undated: [],
        page: 1,
        has_more: false,
      };
    } else if (path === "/api/upgrade")
      data = {
        release: "2026.10.31",
        version: "0.4.0",
        acknowledged: upgrading ? null : "2026.10.31",
        pending: upgrading,
        releases: [
          {
            id: "2026.10.31",
            title: "Storyarr",
            highlights: [
              "A bookshelf page for each followed author or series.",
              "A light theme, with display and accessibility settings.",
              "Wanted books are searched again automatically.",
            ],
            review: [
              {
                id: "layout",
                title: "Layout and display",
                description:
                  "Choose Classic or Shelf, a theme and a text size.",
                link: "/settings#display",
              },
            ],
            database_changes: ["Two new indexes on the operations table."],
            rollback:
              "Downgrade the database to 0082_installation_automation to remove the indexes.",
          },
        ],
        backups: [
          {
            name: "settings-20261031-090000-before-upgrade.json",
            created_at: "2026-10-31T09:00:00Z",
            reason: "before-upgrade",
            size: 20480,
            rows: { metadata_settings: 1, libraries: 1 },
          },
        ],
        automatic: false,
        automatic_from_environment: false,
        way_back: {
          title: "Storyarr",
          database_changes: ["Two new indexes on the operations table."],
          rollback:
            "Downgrade the database to 0082_installation_automation to remove the indexes.",
        },
      };
    return route.fulfill({ json: data });
  });
}

test.use({ viewport: { width: 1440, height: 900 } });

test("bookshelf, light and dark", async ({ page }) => {
  await setup(page);
  await page.goto(`/following/${list}`);
  await expect(
    page
      .getByRole("list", { name: "The Lantern Road books" })
      .locator("img")
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "The Glass Orchard, Downloading 64%" })
    .click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/bookshelf.png` });
});

test("bookshelf, dark", async ({ page }) => {
  await setup(page, "dark");
  await page.goto(`/following/${list}`);
  await expect(
    page
      .getByRole("list", { name: "The Lantern Road books" })
      .locator("img")
      .first(),
  ).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/bookshelf-dark.png` });
});

test("calendar", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-02T10:00:00Z"));
  await setup(page);
  await page.goto("/discover?view=calendar");
  await expect(page.locator(".release-mark-cover").first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/calendar.png` });
});

test("display and accessibility", async ({ page }) => {
  await setup(page);
  await page.goto(`/following/${list}`);
  await expect(
    page
      .getByRole("list", { name: "The Lantern Road books" })
      .locator("img")
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/display.png` });
});

test("upgrade wizard", async ({ page }) => {
  await setup(page, "light", true);
  await page.goto("/upgrade");
  await expect(
    page.getByRole("heading", { name: "Welcome to version 0.4.0" }),
  ).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/upgrade-wizard.png` });
});

test("settings", async ({ page }) => {
  await setup(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/settings.png` });
});

test("my library, with a summary and a newer release", async ({ page }) => {
  await setup(page, "light", false, true);
  await page.goto("/library");
  const books = page.locator(".shelf-book");
  await expect(books.first().locator("img")).toBeVisible();
  await books.nth(6).click();
  await expect(page.locator(".book-summary")).toBeVisible();
  await expect(
    page.locator(".book-summary").getByRole("link", { name: "Mara Ellison" }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/my-library.png` });
});

test("restore previous version", async ({ page }) => {
  await setup(page);
  await page.goto("/settings#upgrades");
  await page.getByText("Restore previous version", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "2. Undo database changes" }),
  ).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/restore-previous-version.png` });
});
