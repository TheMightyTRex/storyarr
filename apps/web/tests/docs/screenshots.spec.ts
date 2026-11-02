import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { emptyDiscoveryHome } from "../fixtures";

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
// More invented books, only for the Discover shelf, so it is long enough to scroll both ways.
const shelfTitles = [
  ...titles,
  "The Weaver of Brightwater",
  "A Season of Small Lamps",
  "The Orchard Keeper",
  "North by Lantern Light",
  "The Hollow Tide",
  "Songs for a Slow River",
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

const authors = ["Mara Ellison", "Tobias Wren", "June Okafor"];

// A cover's author can be chosen with a suffix: /demo-covers/3-1.svg is book 3 by Tobias Wren.
function cover(index: number, author = 0) {
  const [background, ink] = palette[index % palette.length];
  const words = shelfTitles[index].split(" ");
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
    <text x="100" y="226" font-family="Helvetica, sans-serif" font-size="13" letter-spacing="2" fill="${ink}" text-anchor="middle">${authors[author].toUpperCase()}</text>
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

// Invented radio shows, with square artwork drawn here: no real programme or its artwork appears.
const radioShows = [
  ["s1", "The Lantern Hour", "#0f5f73", "#f2c14e"],
  ["s2", "Quiet Carriage", "#5b2a3c", "#f4d6c6"],
  ["s3", "Small Hours", "#23443a", "#e8d7a9"],
  ["s4", "The Copper Kettle Quiz", "#6b3a1f", "#f7e3c3"],
  ["s5", "Tideline Tales", "#2d4f6b", "#cfe8ef"],
  ["s6", "Night Ferry", "#3b2f63", "#f0b67f"],
] as const;
const station4 = { id: "bbc_radio_four", name: "BBC Radio 4", logo_url: null };
const station4x = {
  id: "bbc_radio_four_extra",
  name: "BBC Radio 4 Extra",
  logo_url: null,
};

function showArt(id: string) {
  const found = radioShows.find((item) => item[0] === id) ?? radioShows[0];
  const [, title, background, ink] = found;
  const words = title.split(" ");
  const lines =
    words.length > 2
      ? [words.slice(0, 2).join(" "), words.slice(2).join(" ")]
      : words;
  const text = lines
    .map(
      (line, n) =>
        `<text x="150" y="${150 + n * 36 - (lines.length - 1) * 18}" font-family="Georgia, serif" font-size="30" fill="${ink}" text-anchor="middle">${line}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
    <rect width="300" height="300" fill="${background}"/>
    <circle cx="150" cy="150" r="118" fill="none" stroke="${ink}" stroke-opacity="0.45" stroke-width="3"/>
    ${text}
  </svg>`;
}

function radioShow(index: number) {
  const [id, title] = radioShows[index];
  const station = index % 3 === 2 ? station4x : station4;
  return {
    id,
    provider: "bbc",
    external_id: `b0docs${index}`,
    title,
    synopsis: `${title} is an invented radio show for the screenshots.`,
    first_broadcast: `${2012 + index}-04-03T18:30:00Z`,
    station,
    stations: index === 0 ? [station4, station4x] : [station],
    follow: index === 1 ? "none" : index === 0 ? "all" : "from_now_on",
    followed_at: "2026-11-02T10:00:00Z",
    artwork_url: `/api/radio/shows/${id}/artwork`,
    logo_colour: null,
    logo_source: null,
    series_count: 2 + (index % 3),
    episode_count: 8 + index * 3,
    refreshed_at: "2026-11-02T10:00:00Z",
    refresh: null,
  };
}

function episode(
  id: string,
  number: number,
  title: string,
  first: string,
  status: { kind: string; label: string; detail?: string | null },
  seconds: number | null = 1680,
) {
  return {
    id,
    pid: `m0docs${id}`,
    number,
    number_source: "bbc",
    title,
    synopsis: `${title}: four guests tell the story behind an old lantern.`,
    first_broadcast: first,
    duration_seconds: seconds,
    status,
  };
}

const radioDetail = {
  ...radioShow(0),
  series: [
    {
      id: "series-6",
      pid: "b0docsseries6",
      kind: "series",
      number: 6,
      number_source: "bbc",
      title: "Series 6",
      synopsis: null,
      station: station4,
      expected_episodes: 4,
      first_broadcast: "2026-10-19T18:30:00Z",
      episode_count: 4,
      episodes: [
        episode("e1", 1, "The Harbour Light", "2026-10-19T18:30:00Z", {
          kind: "in_library",
          label: "In library",
        }),
        episode("e2", 2, "Lamps of the Long Pier", "2026-10-26T18:30:00Z", {
          kind: "in_library",
          label: "In library",
        }),
        episode("e3", 3, "A Wick in the Wind", "2026-11-02T18:30:00Z", {
          kind: "wanted",
          label: "Wanted",
          detail: "Broadcast while you follow this show",
        }),
        episode(
          "e4",
          4,
          "The Keeper's Last Night",
          "2026-11-09T18:30:00Z",
          {
            kind: "not_released",
            label: "Not released yet",
            detail: "First broadcast 9 November 2026",
          },
          null,
        ),
      ],
    },
    {
      id: "series-5",
      pid: "b0docsseries5",
      kind: "series",
      number: 5,
      number_source: "bbc",
      title: "Series 5",
      synopsis: null,
      station: station4,
      expected_episodes: 2,
      first_broadcast: "2025-03-03T18:30:00Z",
      episode_count: 2,
      episodes: [
        episode("e5", 1, "Oil and Brass", "2025-03-03T18:30:00Z", {
          kind: "in_library",
          label: "In library",
        }),
        episode("e6", 2, "The Fog Bell", "2025-03-10T18:30:00Z", {
          kind: "not_requested",
          label: "Not requested",
        }),
      ],
    },
  ],
};

function radioApi(path: string, url: URL) {
  if (path === "/api/radio/shows") {
    const station = url.searchParams.get("station");
    let items = radioShows.map((_, index) => radioShow(index));
    if (station)
      items = items.filter((item) =>
        item.stations.some((s) => s.id === station),
      );
    return { items, total: items.length };
  }
  if (path === "/api/radio/stations")
    return {
      items: [
        { ...station4, show_count: 5 },
        { ...station4x, show_count: 3 },
      ],
    };
  if (path === "/api/radio/shows/s1") return radioDetail;
  if (path.startsWith("/api/library/groups/")) return { items: [], total: 0 };
  return undefined;
}

// A Discover shelf of invented books: some formats already in the library, so the ticks show.
function discoverApi(path: string) {
  if (path === "/api/discovery/hardcover/trending")
    return {
      title: "Trending on Hardcover",
      status: "ready",
      has_more: false,
      items: shelfTitles.map((title, index) => ({
        book: {
          provider: "hardcover",
          external_id: `docs-${index}`,
          title,
          authors: [authors[index % 3]],
          cover_url: `/demo-covers/${index}-${index % 3}.svg`,
          rating: 4.1,
        },
        work: {
          ...libraryWork(index % titles.length),
          id: `00000000-0000-0000-0000-0000000005${String(index).padStart(2, "0")}`,
          title,
          authors: [authors[index % 3]],
          cover_url: `/demo-covers/${index}-${index % 3}.svg`,
          availability: {
            owned: index % 4 === 0,
            ebook: index % 4 === 0,
            audio: index % 8 === 0,
          },
        },
      })),
    };
  if (path.startsWith("/api/discovery/"))
    return { title: "Other books", status: "ready", items: [], total: 0 };
  return undefined;
}

// A series page with every book in order: the actions sit at the end of each row.
// A made-up series logo (a lighthouse and a wordmark), drawn for these screenshots.
const glassHarbourLogo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 120">
  <g fill="#000">
    <path d="M38 18h14l3 10h-20z"/><path d="M36 30h18l6 74H30z"/><rect x="24" y="104" width="42" height="8"/>
    <path d="M45 6l9 10H36z"/>
    <path d="M60 22l40-10v4l-40 9zM30 22l-28-9v4l28 8z" opacity=".55"/>
    <text x="84" y="58" font-family="Georgia, 'Times New Roman', serif" font-size="30" letter-spacing="6">THE</text>
    <text x="80" y="104" font-family="Georgia, 'Times New Roman', serif" font-size="54" font-weight="700" letter-spacing="2">GLASS HARBOUR</text>
    <rect x="186" y="46" width="430" height="3"/>
  </g>
</svg>`;

// Series 77 has no logo, so its name is set as a wordmark; series 1042 has the made-up logo.
function seriesApi(path: string, route: Route) {
  if (path === "/api/catalog/series/hardcover/1042/logo")
    return route.fulfill({
      contentType: "image/svg+xml",
      body: glassHarbourLogo,
    });
  const id = path.match(/^\/api\/catalog\/series\/hardcover\/(77|1042)$/)?.[1];
  if (id)
    return {
      external_id: id,
      name: id === "77" ? "The Lantern Road" : "The Glass Harbour",
      description:
        "A harbour town where the lighthouse keeper keeps more than the light. Quiet mysteries, one each winter, told by the people who stay when the boats leave.",
      logo:
        id === "1042"
          ? {
              url: "/api/catalog/series/hardcover/1042/logo?v=1",
              format: "svg",
              colour: "text",
              source: "cover",
              source_title: "the cover of book 1",
              licence: null,
              source_url: null,
              saved_path: "config/series-logos/hardcover-1042.svg",
              updated_at: "2026-11-02T10:00:00Z",
            }
          : null,
      authors: ["Mara Ellison"],
      projection_version: 2,
      generation: 1,
      fetched_at: "2026-10-28T00:00:00Z",
      status: "completed",
      message: "",
      books: 8,
      total: 8,
      raw_total: 8,
      supplements: 0,
      planned: 0,
      owned: 5,
      ebook: 2,
      audio: 5,
      items: titles.slice(0, 8).map((title, index) => ({
        membership_id: `member-${index}`,
        external_id: String(1000 + index),
        position: String(index + 1),
        publication: "published",
        category: "main",
        compilation: false,
        partial: false,
        merged_record: false,
        ambiguous_position: false,
        work: {
          ...libraryWork(index),
          versions: [],
          description: null,
          availability: {
            owned: index < 5,
            ebook: index < 5 && index % 2 === 0,
            audio: index < 5,
            stale: false,
          },
        },
      })),
    };
  if (path.endsWith("/main-books")) return null;
  if (path === "/api/acquisition/profiles" || path === "/api/following")
    return [];
  return undefined;
}

// Extra mocked answers for one screenshot: return data for the path, or undefined to fall through.
type Extra = (path: string, url: URL, route: Route) => unknown;

async function setup(
  page: Page,
  theme: "light" | "dark" = "light",
  upgrading = false,
  newerRelease = false,
  extra?: Extra,
) {
  page.on("pageerror", (error) => console.log(`Page error: ${error.message}`));
  await page.addInitScript((value) => {
    localStorage.setItem(
      "book-search:display:v1",
      JSON.stringify({ theme: value }),
    );
  }, theme);
  await page.route("**/demo-covers/*.svg", (route) => {
    const [, index, author] =
      route
        .request()
        .url()
        .match(/(\d+)(?:-(\d))?\.svg$/) ?? [];
    return route.fulfill({
      contentType: "image/svg+xml",
      body: cover(Number(index ?? 0), Number(author ?? 0)),
    });
  });
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/discovery/home")
      return route.fulfill({ json: emptyDiscoveryHome() });
    if (path.startsWith("/api/radio/") && path.endsWith("/artwork"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: showArt(path.split("/")[4]),
      });
    const special = extra?.(path, url, route);
    if (special instanceof Promise) return special;
    let data: unknown = { items: [], total: 0, offset: 0, limit: 40 };
    if (special !== undefined) data = special;
    else if (path === "/api/auth/me") data = admin;
    else if (path === "/api/preferences")
      data = {
        collection_view: "detail",
        library_views: {},
        cover_size: "medium",
        cover_actions: "on",
      };
    else if (path === "/api/metadata/account")
      data = { enabled: true, suggest_series_gaps: true };
    else if (path.includes("/quick-add/latest/")) data = null;
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/library/libraries") data = [];
    else if (path === "/api/application/release")
      data = {
        installed_version: "v0.5.8",
        installed_url: null,
        latest_version: newerRelease ? "v0.5.9" : "v0.5.8",
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
      data = { effective: { desired_media: "both" } };
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
          authors: [authors[index % 3]],
          cover_url: `/demo-covers/${(index + 3) % titles.length}-${index % 3}.svg`,
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
        release: "2026.11.02",
        version: "0.5.8",
        acknowledged: upgrading ? null : "2026.11.02",
        pending: upgrading,
        releases: [
          {
            id: "2026.11.02",
            title: "Cover actions, shelf arrows and radio",
            highlights: [
              "Series pages have a new header: the series logo above the name, or the name set large when there is no logo.",
              "Every cover has its actions: Details, Ebook, Audiobook, Add to a list and More, on the cover or beside it.",
              "Discover shelves have no scroll bars: the covers fade at each end, with an arrow when there are more books that way.",
              "Radio, an early feature: add BBC radio shows by link or name, and browse shows, stations, series and episodes.",
            ],
            review: [
              {
                id: "cover-actions",
                title: "Cover actions",
                description:
                  "Whether a book's buttons sit on the cover or beside it. Saved with your account.",
                link: "/settings#display",
              },
            ],
            database_changes: [
              "New tables for radio: stations, shows, series and episodes.",
              "A new table for series logos. The logo files are kept in the config folder.",
            ],
            rollback:
              "To go back to v0.4.8, run python -m app.downgrade storyarr_0086_notification_title in the Storyarr container first.",
          },
        ],
        backups: [
          {
            name: "settings-20261102-090000-before-upgrade.json",
            created_at: "2026-11-02T09:00:00Z",
            reason: "before-upgrade",
            size: 20480,
            rows: { metadata_settings: 1, libraries: 1 },
          },
        ],
        automatic: false,
        automatic_from_environment: false,
        way_back: {
          title: "Cover actions, shelf arrows and radio",
          database_changes: [
            "New tables for radio: stations, shows, series and episodes.",
            "A new table for series logos. The logo files are kept in the config folder.",
          ],
          rollback:
            "To go back to v0.4.8, run python -m app.downgrade storyarr_0086_notification_title in the Storyarr container first.",
        },
      };
    return route.fulfill({ json: data });
  });
}

// British dates, as Storyarr's readers see them (the browser's language sets most date formats).
test.use({ viewport: { width: 1440, height: 900 }, locale: "en-GB" });

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
  // Moving focus to Close scrolls the panel a little; show it from the top, as it opens.
  await page
    .getByRole("dialog")
    .evaluate((dialog) =>
      [dialog, ...dialog.querySelectorAll("*")].forEach(
        (node) => (node.scrollTop = 0),
      ),
    );
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/display.png` });
});

test("upgrade wizard", async ({ page }) => {
  await setup(page, "light", true);
  await page.goto("/upgrade");
  await expect(
    page.getByRole("heading", { name: "Welcome to version 0.5.8" }),
  ).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/upgrade-wizard.png` });
});

test("settings", async ({ page }) => {
  await setup(page);
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/settings.png` });
});

test("my library, with a summary and a newer release", async ({ page }) => {
  await setup(page, "light", false, true);
  await page.goto("/library");
  const books = page.locator(".shelf-wall .cover-card");
  await expect(books.first().locator("img")).toBeVisible();
  await page
    .getByRole("button", { name: "The Clockmaker's Daughter, details" })
    .click();
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

test("discover shelf, with cover actions and the shelf arrows", async ({
  page,
}) => {
  await setup(page, "light", false, false, (path) => discoverApi(path));
  await page.goto("/discover");
  const shelf = page.getByRole("region", { name: "Trending books" });
  await expect(shelf.locator(".cover-card img").first()).toBeVisible();
  await shelf
    .getByRole("button", { name: "More books in Trending on Hardcover" })
    .click();
  await page.waitForTimeout(800);
  await shelf.locator(".cover-card").nth(10).hover();
  await page.waitForTimeout(400);
  // Only the shelf: the other Discover shelves have no invented books.
  await page.screenshot({
    path: `${OUT}/discover-shelf.png`,
    clip: { x: 0, y: 0, width: 1440, height: 640 },
  });
});

test("in my libraries, with larger covers", async ({ page }) => {
  await setup(page);
  await page.goto("/library");
  const books = page.locator(".shelf-wall .cover-card");
  await expect(books.first().locator("img")).toBeVisible();
  await books.nth(2).hover();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/library-covers.png` });
});

test("series page, books in order with actions", async ({ page }) => {
  await setup(page, "light", false, false, (path, _url, route) =>
    seriesApi(path, route),
  );
  await page.goto("/series/hardcover/77");
  await expect(page.locator(".book-row").first()).toBeVisible();
  await page
    .getByRole("heading", { name: "Reading order" })
    .evaluate((node) =>
      window.scrollBy({ top: node.getBoundingClientRect().top - 90 }),
    );
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/series-books-in-order.png` });
});

test("series header with a logo", async ({ page }) => {
  await setup(page, "light", false, false, (path, _url, route) =>
    seriesApi(path, route),
  );
  await page.goto("/series/hardcover/1042");
  await page.locator(".series-head .logo-mask").waitFor();
  await expect(page.locator(".series-head img").first()).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/series-header.png` });
});

test("radio shows", async ({ page }) => {
  await setup(page, "light", false, false, (path, url) => radioApi(path, url));
  await page.goto("/library/radio");
  await expect(
    page.getByRole("img", { name: "The Lantern Hour, BBC Radio 4" }),
  ).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/radio-shows.png` });
});

test("radio show page", async ({ page }) => {
  await setup(page, "light", false, false, (path, url) => radioApi(path, url));
  await page.goto("/library/radio/shows/s1");
  await expect(
    page.getByRole("heading", { level: 1, name: "The Lantern Hour" }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/radio-show.png` });
});

test("settings, cover actions", async ({ page }) => {
  await setup(page);
  await page.goto("/settings#display");
  const setting = page.getByRole("group", { name: "Cover actions" });
  await setting.scrollIntoViewIfNeeded();
  await setting.evaluate((node) =>
    node.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/cover-actions-setting.png` });
});
