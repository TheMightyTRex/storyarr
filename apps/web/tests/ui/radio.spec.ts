import {
  expect,
  test,
  emptyDiscoveryHome,
  type Page,
  type TestInfo,
} from "../fixtures";

// Radio R2: My library's Radio tab (Shows and Stations), a station, a show with its series and episode
// details, Add a show, and the Radio filter on the Series tab. Every /api/radio response is mocked.

const r4 = {
  id: "bbc_radio_four",
  name: "BBC Radio 4",
  logo_url: "/api/radio/stations/bbc_radio_four/logo",
};
const r4x = {
  id: "bbc_radio_four_extra",
  name: "BBC Radio 4 Extra",
  logo_url: null,
};

const ep = (
  id: string,
  number: number,
  title: string,
  first: string,
  status: { kind: string; label: string; detail?: string | null },
  seconds: number | null = 1680,
) => ({
  id,
  pid: `m00${id}`,
  number,
  number_source: "bbc",
  title,
  synopsis: `${title}: four panellists hide true facts among the lies.`,
  first_broadcast: first,
  duration_seconds: seconds,
  status,
});
const inLibrary = { kind: "in_library", label: "In library" };
const notRequested = { kind: "not_requested", label: "Not requested" };

function show(id: string, title: string, extra: object = {}) {
  return {
    id,
    provider: "bbc",
    external_id: `b00${id}`,
    title,
    synopsis: `${title} is a radio show for the tests.`,
    first_broadcast: "2006-04-03T18:30:00Z",
    station: r4,
    stations: [r4],
    follow: "from_now_on",
    followed_at: "2026-11-02T10:00:00Z",
    artwork_url: null,
    logo_colour: null,
    logo_source: null,
    series_count: 2,
    episode_count: 4,
    refreshed_at: "2026-11-02T10:00:00Z",
    refresh: null,
    ...extra,
  };
}

const truth = show("s1", "The Unbelievable Truth", {
  artwork_url: "/api/radio/shows/s1/artwork",
  stations: [r4, r4x],
  follow: "all",
});
const shows = [
  truth,
  show("s2", "Quiet Carriage", { follow: "none", series_count: 1 }),
  show("s3", "Small Hours", { station: r4x, stations: [r4x] }),
];
const detail = {
  ...truth,
  series: [
    {
      id: "series-19",
      pid: "b0series19",
      kind: "series",
      number: 19,
      number_source: "bbc",
      title: "Series 19",
      synopsis: null,
      station: r4,
      expected_episodes: 2,
      first_broadcast: "2025-03-03T18:30:00Z",
      episode_count: 2,
      episodes: [
        ep(
          "e1",
          1,
          "Pianos, Hedges and Toast",
          "2025-03-03T18:30:00Z",
          inLibrary,
        ),
        ep(
          "e2",
          2,
          "Eels, Kettles and Opera",
          "2025-03-10T18:30:00Z",
          notRequested,
        ),
      ],
    },
    {
      id: "series-20",
      pid: "b0series20",
      kind: "series",
      number: 20,
      number_source: "bbc",
      title: "Series 20",
      synopsis: null,
      station: r4,
      expected_episodes: 3,
      first_broadcast: "2026-10-26T18:30:00Z",
      episode_count: 3,
      episodes: [
        ep(
          "e3",
          1,
          "Owls, Ladders and Soup",
          "2026-10-26T18:30:00Z",
          inLibrary,
        ),
        ep("e4", 2, "Lighthouses, Gravy and Kites", "2026-11-02T18:30:00Z", {
          kind: "wanted",
          label: "Wanted",
          detail: "Broadcast while you follow this show",
        }),
        ep(
          "e5",
          3,
          "Clocks, Snow and Marmalade",
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
  ],
};

const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#0f7a74"/></svg>`;
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#222"/><text x="10" y="26" fill="#fff" font-size="16">Radio 4</text></svg>`;

async function mockApi(
  page: Page,
  role = "admin",
  // The Radio tab follows the Series layout choice; most tests look at the grid.
  view: "list" | "detail" = "list",
) {
  const errors: string[] = [];
  const writes: { method: string; path: string; body: unknown }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/discovery/home")
      return route.fulfill({ json: emptyDiscoveryHome() });
    if (path === "/api/radio/shows/s1/artwork")
      return route.fulfill({ contentType: "image/svg+xml", body: artwork });
    if (path === "/api/radio/stations/bbc_radio_four/logo")
      return route.fulfill({ contentType: "image/svg+xml", body: logo });
    if (request.method() !== "GET")
      writes.push({
        method: request.method(),
        path,
        body: request.postDataJSON(),
      });
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/preferences") data = { collection_view: view };
    else if (path === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          role,
          username: "reader",
          display_name: "Reader",
          onboarding_status: "complete",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/library/libraries") data = [];
    else if (path === "/api/radio/shows" && request.method() === "GET") {
      const station = url.searchParams.get("station");
      const followed = url.searchParams.get("followed");
      let items = shows;
      if (station)
        items = items.filter((item) =>
          item.stations.some((s: { id: string }) => s.id === station),
        );
      if (followed === "true")
        items = items.filter((item) => item.follow !== "none");
      if (followed === "false")
        items = items.filter((item) => item.follow === "none");
      data = { items, total: items.length };
    } else if (path === "/api/radio/stations")
      data = {
        items: [
          { ...r4, show_count: 2 },
          { ...r4x, show_count: 2 },
        ],
      };
    else if (path === "/api/radio/shows/s1" && request.method() === "GET")
      data = detail;
    else if (path === "/api/radio/shows/s1" && request.method() === "PATCH")
      data = { ...truth, ...(request.postDataJSON() as object) };
    else if (path === "/api/radio/shows/s1/refresh")
      return route.fulfill({
        status: 202,
        json: {
          id: "op-1",
          kind: "radio.show.refresh",
          status: "queued",
          message: "Waiting to start",
          created_at: "2026-11-02T10:00:00Z",
          updated_at: "2026-11-02T10:00:00Z",
        },
      });
    else if (path === "/api/radio/search")
      data = {
        source: "bbc_sounds",
        items: [
          {
            pid: "b0museum",
            title: "The Museum of Small Disasters",
            synopsis: "Comedy about the things that went wrong.",
            station_id: "bbc_radio_four",
            station_name: "BBC Radio 4",
            image_pid: "p0abc123",
          },
          {
            pid: "b0atsea",
            title: "Small Disasters at Sea",
            synopsis: "Drama.",
            station_id: "bbc_radio_four_extra",
            station_name: "BBC Radio 4 Extra",
            image_pid: null,
          },
        ],
      };
    else if (path === "/api/radio/preview")
      data = {
        pid: "b0museum",
        title: "The Museum of Small Disasters",
        synopsis: "Comedy about the things that went wrong.",
        first_broadcast: "2019-05-14T18:30:00Z",
        station: r4,
        image_pid: "p0abc123",
        series_count: 5,
        episode_count: 31,
        series: [],
        existing_show_id: null,
      };
    else if (path === "/api/radio/shows" && request.method() === "POST")
      return route.fulfill({
        status: 201,
        json: show("new-show", "The Museum of Small Disasters"),
      });
    else if (path === "/api/radio/shows/new-show")
      data = {
        ...show("new-show", "The Museum of Small Disasters"),
        series: [],
      };
    else if (path.startsWith("/api/library/groups/"))
      data = { items: [], total: 0 };
    return route.fulfill({ json: data });
  });
  return { errors, writes };
}

async function shots(
  page: Page,
  info: TestInfo,
  name: string,
  ready: () => Promise<unknown>,
) {
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
      await ready();
      await page.screenshot({
        path: info.outputPath(`${name}-${theme}-${width}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }
  }
  await page.evaluate(() => localStorage.removeItem("book-search:display:v1"));
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("My library has a Radio tab with Shows and Stations, each with its own address", async ({
  page,
}, info) => {
  const { errors } = await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library");
  await page
    .getByRole("navigation", { name: "Library shelves" })
    .getByRole("link", { name: "Radio" })
    .click();
  await expect(page).toHaveURL(/\/library\/radio$/);
  await expect(
    page
      .getByRole("navigation", { name: "Library shelves" })
      .getByRole("link", { name: "Radio" }),
  ).toHaveAttribute("aria-current", "page");
  // The switch comes first in the toolbar.
  const filters = page.getByRole("group", { name: "Filters" });
  await expect(filters.getByRole("radio", { name: "Shows" })).toBeChecked();
  await expect(page.getByText("3 shows · 12 episodes")).toBeVisible();
  // Square artwork in the 2:3 book shape: image at the top, the label in its main colour below.
  const art = page.getByRole("img", {
    name: "The Unbelievable Truth, BBC Radio 4",
  });
  await expect(art).toBeVisible();
  const box = (await art.boundingBox())!;
  expect(Math.abs(box.height / box.width - 1.5)).toBeLessThan(0.02);
  const image = (await art.locator("img").boundingBox())!;
  expect(Math.round(image.width)).toBe(Math.round(image.height));
  await expect
    .poll(() =>
      art.evaluate((node) =>
        getComputedStyle(node).getPropertyValue("--show-art-bg"),
      ),
    )
    .toMatch(/rgb\(/);
  await expect(art.locator(".show-art__label")).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  // A show with no artwork has its name as a text tile and a neutral label.
  await expect(
    page
      .getByRole("img", { name: "Quiet Carriage, BBC Radio 4" })
      .locator(".show-art__text"),
  ).toHaveText("Quiet Carriage");
  // Covers line up, whatever the title length.
  const tops = await page
    .locator(".show-card .cover-card__art")
    .evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
    );
  expect(new Set(tops).size).toBe(1);
  // The Following filter asks the server.
  await filters.getByRole("button", { name: /Not followed/ }).click();
  await expect(page).toHaveURL(/follow=not/);
  await expect(page.locator(".show-card")).toHaveCount(1);
  await page.goto("/library/radio");
  await shots(page, info, "shows", () =>
    page.locator(".show-card").first().waitFor(),
  );

  // Stations: its own address, logos with a text tile when there is none.
  await page
    .getByRole("group", { name: "Filters" })
    .getByRole("radio", { name: "Stations" })
    .click();
  await expect(page).toHaveURL(/\/library\/radio\/stations$/);
  const stations = page.locator(".station-card");
  await expect(stations).toHaveCount(2);
  await expect(stations.first().locator("img")).toHaveAttribute(
    "src",
    "/api/radio/stations/bbc_radio_four/logo",
  );
  await expect(stations.nth(1).locator(".logo-tile__text")).toHaveText(
    "BBC Radio 4 Extra",
  );
  await expect(stations.first()).toContainText("2 shows · 1 following");
  await shots(page, info, "stations", () =>
    page.locator(".station-card").first().waitFor(),
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/library\/radio$/);
  await page.goForward();

  // A station page lists its shows; a show that started elsewhere is listed separately.
  await stations.first().getByRole("link", { name: "BBC Radio 4" }).click();
  await expect(page).toHaveURL(/\/library\/radio\/stations\/bbc_radio_four$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "BBC Radio 4" }),
  ).toBeVisible();
  await expect(page.locator(".show-card")).toHaveCount(2);
  await page.goto("/library/radio/stations/bbc_radio_four_extra");
  await expect(
    page.getByRole("heading", {
      name: "Also first broadcast on BBC Radio 4 Extra",
    }),
  ).toBeVisible();
  await shots(page, info, "station", () =>
    page.locator(".show-card").first().waitFor(),
  );
  expect(errors).toEqual([]);
});

test("in List and detail, the shows are a list beside the chosen show's own page", async ({
  page,
}) => {
  const { errors } = await mockApi(page, "admin", "detail");
  await page.setViewportSize({ width: 1440, height: 900 });
  // Only The Unbelievable Truth has a full show in this mock, so the page opens on it.
  await page.goto("/library/radio?pick=s1");
  const list = page.getByRole("navigation", { name: "Radio shows" });
  await expect(list.getByRole("button")).toHaveCount(3);
  const pane = page.getByRole("region", { name: "The Unbelievable Truth" });
  // The show page's header, with the name as a level 2 heading and no back link.
  await expect(
    pane.getByRole("heading", { level: 2, name: "The Unbelievable Truth" }),
  ).toBeVisible();
  await expect(pane.getByRole("link", { name: "Back to Radio" })).toHaveCount(
    0,
  );
  await expect(
    list.getByRole("button", { name: /The Unbelievable Truth/ }),
  ).toHaveAttribute("aria-current", "true");
  expect(errors).toEqual([]);
});

test("a show page has the header, follow choice, refresh, series newest first and episode details", async ({
  page,
}, info) => {
  const { errors, writes } = await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library/radio/shows/s1");
  await expect(
    page.getByRole("heading", { level: 1, name: "The Unbelievable Truth" }),
  ).toHaveClass(/radio-wordmark/);
  await expect(page.locator(".radio-show-meta")).toContainText(
    "BBC Radio 4First broadcast 3 April 20062 series, 4 episodesAlso on BBC Radio 4 Extra",
  );
  // 2 of the 4 broadcast episodes are in the library; the one not yet broadcast does not count.
  await expect(
    page.getByText("2 of 4 broadcast episodes in your library (50%)"),
  ).toBeVisible();
  // Series as folding sections, newest first; the newest starts open.
  const sections = page.locator("details.radio-series");
  await expect(sections.locator("summary")).toContainText([
    "Series 20",
    "Series 19",
  ]);
  await expect(sections.first()).toHaveAttribute("open", "");
  const table = page.getByRole("table", { name: "Series 20 episodes" });
  await expect(table.getByRole("row").nth(1)).toContainText("S20E01");
  await expect(table.getByRole("row").nth(3)).toContainText(
    "Not released · 9 Nov 2026",
  );
  await expect(table.getByRole("row").nth(3)).toContainText("Not known yet");
  // The standard status words.
  await expect(table.locator(".chip").first()).toHaveText("In library");
  await expect(table.locator(".chip").nth(1)).toHaveText("Wanted");

  // Follow: all, from now on or none, saved at once.
  const follow = page.getByRole("group", { name: "Follow" });
  await expect(follow.getByRole("radio", { name: "All series" })).toBeChecked();
  await follow.getByRole("radio", { name: "From now on" }).click();
  await expect
    .poll(() => writes.find((write) => write.method === "PATCH"))
    .toEqual({
      method: "PATCH",
      path: "/api/radio/shows/s1",
      body: { follow: "from_now_on" },
    });
  // Refresh asks for a new read of the BBC list.
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect
    .poll(() =>
      writes.some((write) => write.path === "/api/radio/shows/s1/refresh"),
    )
    .toBe(true);

  // Go to series opens and jumps to an older series.
  await page
    .getByRole("combobox", { name: "Go to series" })
    .selectOption({ label: "Series 19" });
  await expect(sections.nth(1)).toHaveAttribute("open", "");

  // Episode details in the slide-out, with Previous and Next.
  await table
    .getByRole("button", { name: "Lighthouses, Gravy and Kites" })
    .click();
  const panel = page.getByRole("dialog", { name: /Episode S20E02/ });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Series 20, episode 2");
  await expect(panel).toContainText("Broadcast while you follow this show");
  await shots(page, info, "episode", async () => {
    await page
      .getByRole("button", { name: "Lighthouses, Gravy and Kites" })
      .click();
    await page.getByRole("dialog", { name: /Episode S20E02/ }).waitFor();
  });
  await page.getByRole("button", { name: /Next episode/ }).click();
  await expect(
    page.getByRole("dialog", { name: /Episode S20E03/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Lighthouses, Gravy and Kites" }),
  ).toBeFocused();
  await shots(page, info, "show", () =>
    page
      .getByRole("heading", { level: 1, name: "The Unbelievable Truth" })
      .waitFor(),
  );
  expect(errors).toEqual([]);
});

test("Add a show finds it by name, previews it, follows from now on by default and opens it", async ({
  page,
}, info) => {
  const { errors, writes } = await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library/radio");
  await page.getByRole("button", { name: "Add a show" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a show" });
  const field = dialog.getByRole("textbox", { name: "Link or show name" });
  await expect(field).toBeFocused();
  await field.fill("small disasters");
  await dialog.getByRole("button", { name: "Find show" }).click();
  await expect(dialog.getByText("2 shows found")).toBeVisible();
  await dialog
    .getByRole("radio", { name: /The Museum of Small Disasters/ })
    .check();
  await expect(dialog.getByText("What will be added")).toBeVisible();
  await expect(dialog).toContainText("5 series, 31 episodes");
  await expect(
    dialog.getByRole("radio", { name: /From now on/ }),
  ).toBeChecked();
  await dialog.screenshot({ path: info.outputPath("add-show-light-1440.png") });
  await dialog.getByRole("button", { name: "Add show" }).click();
  await expect(page).toHaveURL(/\/library\/radio\/shows\/new-show$/);
  expect(writes.find((write) => write.method === "POST")).toEqual({
    method: "POST",
    path: "/api/radio/shows",
    body: {
      link: "https://www.bbc.co.uk/programmes/b0museum",
      follow: "from_now_on",
    },
  });

  // A link goes straight to the preview.
  await page.goto("/library/radio");
  await page.getByRole("button", { name: "Add a show" }).click();
  await dialog
    .getByRole("textbox", { name: "Link or show name" })
    .fill("https://www.bbc.co.uk/sounds/brands/b0museum");
  await dialog.getByRole("button", { name: "Find show" }).click();
  await expect(dialog.getByText("What will be added")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("add-show-light-390.png") });
  expect(errors).toEqual([]);
});

test("the Series tab's Radio chip shows radio shows; Discover says what is missing", async ({
  page,
}) => {
  const { errors } = await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/library?view=series");
  const filters = page.getByRole("group", { name: "Filters" });
  await filters.getByRole("button", { name: "Radio", exact: true }).click();
  await expect(page).toHaveURL(/medium=radio/);
  await expect(page.locator(".show-card")).toHaveCount(3);
  await expect(
    filters.getByRole("button", { name: "Radio", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await filters.getByRole("button", { name: "Radio", exact: true }).click();
  await expect(page.locator(".show-card")).toHaveCount(0);

  // Discover's format choice cannot list radio yet: the choice is there, switched off, with a hint.
  await page.goto("/discover/series");
  const option = page.getByRole("option", { name: "Radio shows" });
  await expect(option).toHaveAttribute("disabled", "");
  await expect(
    page.getByText(/Radio shows are not in this list yet/),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("a show's logo is cut from its artwork with the same Change logo slide-out (UX-43)", async ({
  page,
}) => {
  const { errors } = await mockApi(page);
  const uploads: { search: string; type: string; head: string }[] = [];
  // Routes added later answer first: artwork with a light name on a dark ground, and the upload.
  await page.route("**/api/radio/shows/s1/artwork", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#0d1b2a"/><rect x="40" y="30" width="220" height="50" fill="#f5f5f5"/></svg>`,
    }),
  );
  await page.route("**/api/radio/shows/s1/logo?*", (route) => {
    const request = route.request();
    uploads.push({
      search: new URL(request.url()).search,
      type: request.headers()["content-type"] || "",
      head: request.postDataBuffer()?.subarray(0, 4).toString("hex") || "",
    });
    return route.fulfill({
      json: {
        url: "/api/radio/shows/s1/logo?v=1",
        format: "png",
        colour: "text",
        source: "cover",
        source_title: "the artwork",
        licence: null,
        source_url: null,
        saved_path: "config/series-logos/radio-s1.png",
        updated_at: "2026-11-02T10:00:00Z",
      },
    });
  });
  await page.goto("/library/radio/shows/s1");
  await page.getByRole("button", { name: "Add a logo", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Show logo" });
  await expect(
    panel.getByRole("tab", { name: "From the artwork" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    panel.getByText("No logo saved. The show name is shown as a wordmark."),
  ).toBeVisible();
  await expect(
    panel.locator(".logo-crop__controls [role=status]"),
  ).toContainText("pixels");
  await panel.getByRole("button", { name: "Save logo" }).click();
  await expect(panel).toBeHidden();
  expect(uploads).toHaveLength(1);
  expect(new URLSearchParams(uploads[0].search).get("source")).toBe("cover");
  expect(uploads[0].type).toBe("image/png");
  expect(uploads[0].head).toBe("89504e47");
  await expect(page.getByRole("button", { name: "Add a logo" })).toBeFocused();
  expect(errors).toEqual([]);
});
