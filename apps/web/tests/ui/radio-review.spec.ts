import { expect, test, emptyDiscoveryHome, type Page } from "../fixtures";

// RADIO-03: Review the radio library. Shows in the radio library that are not in your radio
// shows (Find on the BBC, Already added), and files that match no episode (Link, Not this file).
// Every /api/radio response is mocked.

const r4 = {
  id: "bbc_radio_four",
  name: "BBC Radio 4",
  logo_url: null,
};

function show(id: string, title: string, extra: object = {}) {
  return {
    id,
    provider: "bbc",
    external_id: `b00${id}`,
    title,
    synopsis: null,
    first_broadcast: "2000-01-05T18:30:00Z",
    station: r4,
    stations: [r4],
    follow: "from_now_on",
    followed_at: "2026-11-03T10:00:00Z",
    artwork_url: null,
    logo_colour: null,
    logo_source: null,
    series_count: 1,
    episode_count: 2,
    refreshed_at: "2026-11-03T10:00:00Z",
    refresh: null,
    ...extra,
  };
}

const power = show("s1", "Absolute Power");
const episode = (id: string, number: number, status = "not_requested") => ({
  id,
  pid: `b00${id}`,
  number,
  number_source: "bbc",
  title: `Episode ${number}`,
  synopsis: null,
  first_broadcast: "2008-05-01T18:30:00Z",
  duration_seconds: 1680,
  status: {
    kind: status,
    label: status === "in_library" ? "In library" : "Not requested",
  },
});
const detail = {
  ...power,
  series: [
    {
      id: "series-4",
      pid: "b0series4",
      kind: "series",
      number: 4,
      number_source: "bbc",
      title: "Series 4",
      synopsis: null,
      station: r4,
      expected_episodes: 2,
      first_broadcast: "2008-05-01T18:30:00Z",
      episode_count: 2,
      episodes: [episode("e1", 1, "in_library"), episode("e2", 2)],
    },
  ],
};

async function mockApi(page: Page) {
  const errors: string[] = [];
  const writes: { method: string; path: string; body: unknown }[] = [];
  const state = {
    review: {
      library: "Radio",
      synced_at: "2026-11-03T10:00:00Z",
      shows: [
        { item_id: "item-manor", title: "To The Manor Born", files: 10 },
        { item_id: "item-hamish", title: "Hamish And Dougal", files: 18 },
      ],
      unmatched: [
        {
          show_id: "s1",
          title: "Absolute Power",
          files: [
            {
              id: "f1",
              name: "Absolute Power - S01E01 - Conservative Party.mp3",
              title: "Conservative Party",
              season: 1,
              episode: 1,
            },
            {
              id: "f2",
              name: "Absolute Power - S01E02 - Relaunch Of The Sun.mp3",
              title: "Relaunch Of The Sun",
              season: 1,
              episode: 2,
            },
          ],
        },
      ],
      unmatched_files: 2,
    },
    manual: false,
  };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/discovery/home")
      return route.fulfill({ json: emptyDiscoveryHome() });
    if (method !== "GET")
      writes.push({ method, path, body: request.postDataJSON() });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/preferences") data = { collection_view: "list" };
    else if (path === "/api/auth/me")
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
    else if (path === "/api/library/libraries") data = [];
    else if (path === "/api/radio/library/review") data = state.review;
    else if (path === "/api/radio/shows" && method === "GET")
      data = { items: [power], total: 1 };
    else if (path === "/api/radio/shows/s1" && method === "GET") data = detail;
    else if (path === "/api/radio/shows/s1" && method === "PATCH") {
      state.review = {
        ...state.review,
        shows: state.review.shows.filter(
          (row) => row.item_id !== "item-hamish",
        ),
      };
      data = power;
    } else if (path === "/api/radio/episodes/e2/file") {
      state.review = {
        ...state.review,
        unmatched: [
          {
            ...state.review.unmatched[0],
            files: state.review.unmatched[0].files.slice(1),
          },
        ],
        unmatched_files: 1,
      };
      data = {};
    } else if (path === "/api/radio/episodes/e1") {
      data = {
        ...episode("e1", 1, state.manual ? "not_requested" : "in_library"),
        file: state.manual
          ? null
          : {
              id: "f9",
              name: "Absolute Power - S04E01 - The BBC.mp3",
              size: 20_000_000,
              library: "Radio",
            },
        file_manual: state.manual,
      };
    } else if (path === "/api/radio/episodes/e1/file") {
      state.manual = method === "PUT";
      data = {
        ...episode("e1", 1, state.manual ? "not_requested" : "in_library"),
        file: state.manual
          ? null
          : {
              id: "f9",
              name: "Absolute Power - S04E01 - The BBC.mp3",
              size: 20_000_000,
              library: "Radio",
            },
        file_manual: state.manual,
      };
    } else if (path === "/api/radio/search")
      data = {
        sources: ["BBC"],
        failed: [],
        items: [
          {
            source: "bbc",
            source_name: "BBC",
            link: "https://www.bbc.co.uk/programmes/b0manor",
            pid: "b0manor",
            title: "To the Manor Born",
            synopsis: "The radio series.",
            station_id: "bbc_radio_four_extra",
            station_name: "BBC Radio 4 Extra",
            image_pid: null,
          },
        ],
      };
    else if (path === "/api/radio/preview")
      data = {
        pid: "b0manor",
        title: "To the Manor Born",
        synopsis: "The radio series.",
        first_broadcast: "1997-12-25T18:30:00Z",
        station: r4,
        image_pid: null,
        series_count: 1,
        episode_count: 10,
        series: [],
        existing_show_id: null,
      };
    else if (path === "/api/radio/shows" && method === "POST") {
      state.review = {
        ...state.review,
        shows: state.review.shows.filter((row) => row.item_id !== "item-manor"),
      };
      return route.fulfill({
        status: 201,
        json: show("s2", "To the Manor Born"),
      });
    }
    return route.fulfill({ json: data });
  });
  return { errors, writes };
}

test("Radio says what the radio library holds, and the review adds a show from it", async ({
  page,
}) => {
  const { errors, writes } = await mockApi(page);
  await page.goto("/library/radio");
  const notice = page.locator(".radio-review-notice");
  await expect(notice).toHaveText(
    "Your radio library has 2 shows not in your radio shows and 2 files that match no episode. Review the radio library",
  );
  await notice.getByRole("link", { name: "Review the radio library" }).click();
  await expect(page).toHaveURL(/\/library\/radio\/review$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Review the radio library" }),
  ).toBeVisible();

  const toAdd = page.getByRole("region", { name: "Shows to add" });
  await expect(toAdd.getByRole("listitem")).toHaveCount(2);
  await toAdd
    .getByRole("button", { name: "Find on the BBC: To The Manor Born" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add a show" });
  await expect(dialog.getByLabel("Link or show name")).toHaveValue(
    "To The Manor Born",
  );
  await dialog.getByRole("radio", { name: /To the Manor Born/ }).check();
  await dialog.getByRole("button", { name: "Add show" }).click();
  await expect(dialog).toBeHidden();
  expect(writes.at(-1)).toEqual({
    method: "POST",
    path: "/api/radio/shows",
    body: {
      link: "https://www.bbc.co.uk/programmes/b0manor",
      follow: "from_now_on",
      library_item_id: "item-manor",
    },
  });
  await expect(toAdd.getByRole("status")).toContainText(
    "To the Manor Born added.",
  );
  await expect(page).toHaveURL(/\/library\/radio\/review$/);
  await expect(toAdd.getByRole("listitem")).toHaveCount(1);

  // Already added under the BBC's own name: use the folder's files for it.
  await toAdd
    .getByRole("button", { name: "Already added: Hamish And Dougal" })
    .click();
  await toAdd
    .getByLabel("Your show for Hamish And Dougal")
    .selectOption({ label: "Absolute Power" });
  await toAdd.getByRole("button", { name: "Use these files" }).click();
  expect(writes.at(-1)).toEqual({
    method: "PATCH",
    path: "/api/radio/shows/s1",
    body: { library_item_id: "item-hamish" },
  });
  await expect(
    toAdd.getByText("Every show in the radio library is in your radio shows."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("a file that matches no episode is linked by hand", async ({ page }) => {
  const { errors, writes } = await mockApi(page);
  await page.goto("/library/radio/review");
  const files = page.getByRole("region", {
    name: "Files that match no episode",
  });
  await files.locator("summary", { hasText: "Absolute Power" }).click();
  const choose = files.getByLabel(
    "Episode in Absolute Power - S01E01 - Conservative Party.mp3",
  );
  await expect(choose.locator("option")).toHaveText([
    "Choose the episode",
    "Series 4, episode 1 (has a file)",
    "Series 4, episode 2",
  ]);
  await choose.selectOption({ label: "Series 4, episode 2" });
  await files
    .getByRole("button", {
      name: "Link Absolute Power - S01E01 - Conservative Party.mp3",
    })
    .click();
  expect(writes.at(-1)).toEqual({
    method: "PUT",
    path: "/api/radio/episodes/e2/file",
    body: { file_id: "f1" },
  });
  await expect(files.getByRole("listitem")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("an episode's file can be set aside and matched automatically again", async ({
  page,
}) => {
  const { errors, writes } = await mockApi(page);
  await page.goto("/library/radio/shows/s1");
  await page
    .getByRole("button", { name: /Episode 1/ })
    .first()
    .click();
  const panel = page.getByRole("dialog");
  await expect(
    panel.getByText("Absolute Power - S04E01 - The BBC.mp3"),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Not this file" }).click();
  expect(writes.at(-1)).toEqual({
    method: "PUT",
    path: "/api/radio/episodes/e1/file",
    body: { file_id: null },
  });
  await expect(panel.getByText("No file (chosen by hand)")).toBeVisible();
  await panel
    .getByRole("button", { name: "Match automatically again" })
    .click();
  expect(writes.at(-1)?.method).toBe("DELETE");
  await expect(
    panel.getByText("Absolute Power - S04E01 - The BBC.mp3"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("the review fits a phone and reads in light and dark", async ({
  page,
}, info) => {
  const { errors } = await mockApi(page);
  await page.goto("/library/radio/review");
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
      const files = page.getByRole("region", {
        name: "Files that match no episode",
      });
      await files.locator("summary", { hasText: "Absolute Power" }).click();
      await expect(files.locator("select").first()).toBeEnabled();
      // Side-by-side controls share one height.
      const heights = await page
        .locator(".radio-review-row select, .radio-review-row button")
        .evaluateAll((items) =>
          items.map((item) => Math.round(item.getBoundingClientRect().height)),
        );
      expect(new Set(heights)).toEqual(new Set([44]));
      await page.screenshot({
        path: info.outputPath(`radio-review-${theme}-${width}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }
  }
  expect(errors).toEqual([]);
});
