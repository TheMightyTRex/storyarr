import { expect, test, type Page } from "../fixtures";

const types = [
  { id: "comedy", label: "All comedy", group: "Comedy" },
  {
    id: "drama-scifiandfantasy",
    label: "Science fiction and fantasy",
    group: "Drama",
  },
  { id: "drama-crime", label: "Crime", group: "Drama" },
  { id: "news", label: "News", group: "Factual" },
];
const stations = [
  ["bbc_radio_four_extra", "Radio 4 Extra", 3],
  ["bbc_radio_four", "Radio 4", 0],
  ["bbc_radio_two", "Radio 2", 0],
  ["bbc_radio_five_live", "Radio 5 Live", 0],
  ["bbc_world_service", "World Service", 0],
].map(([id, name, show_count]) => ({
  id,
  name,
  show_count,
  logo_url: `https://sounds.files.bbci.co.uk/3.12.0/networks/${id}/blocks-colour_default.svg`,
}));

function shows(prefix: string) {
  return Array.from({ length: 8 }, (_, index) => ({
    pid: `p0${prefix.slice(0, 2)}000${index}`,
    title: `${prefix} show ${index + 1}`,
    synopsis: null,
    station_id: "bbc_radio_four",
    station_name: "Radio 4",
    image_url: `https://ichef.bbci.co.uk/images/ic/320x320/p0000${index}.jpg`,
    show_id: index === 1 ? "show-two" : null,
  }));
}

async function setup(page: Page) {
  const state = {
    radio_types: ["comedy", "drama-scifiandfantasy"],
    saved: null as unknown,
    popular: [] as string[],
  };
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    let data: unknown = [];
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "user",
          role: "admin",
          display_name: "Reader",
          onboarding_status: "complete",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/preferences" && method === "PATCH") {
      state.saved = route.request().postDataJSON();
      Object.assign(state, state.saved);
      data = { cover_size: "medium", radio_types: state.radio_types };
    } else if (path === "/api/preferences")
      data = { cover_size: "medium", radio_types: state.radio_types };
    else if (path === "/api/radio/discover")
      data = { stations, types, chosen: state.radio_types };
    else if (path === "/api/radio/discover/popular") {
      const key =
        url.searchParams.get("type") ?? url.searchParams.get("station")!;
      state.popular.push(key);
      data = { items: shows(key) };
    }
    return route.fulfill({ json: data });
  });
  return state;
}

test("For you has Books and Radio, and Radio shows stations and popular shows by type", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/discover?for=radio");
  const sections = page.getByRole("navigation", { name: "For you sections" });
  await expect(sections.getByRole("link", { name: "Radio" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(sections.getByRole("link", { name: "Books" })).toHaveAttribute(
    "href",
    "/discover",
  );
  const radio = page.getByRole("region", { name: "Radio" });
  const tiles = radio.locator(".discover-station");
  await expect(tiles).toHaveCount(5);
  await expect(tiles.first()).toContainText("3 of your shows");
  await expect(
    radio.getByRole("heading", { name: "Popular in All comedy" }),
  ).toBeVisible();
  await expect(
    radio.getByRole("heading", {
      name: "Popular in Science fiction and fantasy",
    }),
  ).toBeVisible();
  await expect(
    radio.getByRole("button", { name: "Add comedy show 1" }),
  ).toBeVisible();
  await expect(
    radio.getByRole("link", { name: "comedy show 2, in your radio" }),
  ).toHaveAttribute("href", "/library/radio/shows/show-two");

  // A station adds its own popular row first; pressing it again removes the row.
  const four = tiles.filter({ hasText: "Radio 4 Extra" });
  await four.click();
  await expect(four).toHaveAttribute("aria-pressed", "true");
  await expect(
    radio.getByRole("heading", { name: "Popular on Radio 4 Extra" }),
  ).toBeVisible();
  expect(state.popular).toContain("bbc_radio_four_extra");
  await four.click();
  await expect(
    radio.getByRole("heading", { name: "Popular on Radio 4 Extra" }),
  ).toHaveCount(0);
});

test("the radio types are chosen in a dialog and saved with the account", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/discover?for=radio");
  await page.getByRole("button", { name: "Choose types" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose radio types" });
  await expect(dialog.getByRole("group", { name: "Drama" })).toBeVisible();
  await dialog.getByLabel("All comedy").uncheck();
  await dialog.getByLabel("Crime").check();
  await dialog.getByLabel("News").check();
  await dialog.getByRole("button", { name: "Save types" }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.saved).toEqual({
    radio_types: ["drama-scifiandfantasy", "drama-crime", "news"],
  });
  const radio = page.getByRole("region", { name: "Radio" });
  await expect(radio.getByRole("heading", { name: /^Popular in/ })).toHaveText([
    "Popular in Science fiction and fantasy",
    "Popular in Crime",
    "Popular in News",
  ]);
});

test("with no types chosen Radio says how to choose some", async ({ page }) => {
  const state = await setup(page);
  state.radio_types = [];
  await page.goto("/discover?for=radio");
  await expect(page.getByText("No types chosen.")).toBeVisible();
  await expect(page.locator(".discover-station")).toHaveCount(5);
});
