import { expect, test, type Page } from "../fixtures";

const chosen = {
  integration_id: "abs",
  server_name: "Home ABS",
  library_id: "radio-lib",
  name: "Radio",
  abs_folder: "/radio",
  local_path: "/media/radio",
  synced_at: "2026-11-02T21:40:00Z",
  last_error: null,
  files: 12,
  linked: 10,
};

async function setup(page: Page) {
  const state = {
    current: null as typeof chosen | null,
    saved: null as Record<string, unknown> | null,
    syncs: 0,
  };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
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
    else if (path.startsWith("/api/acquisition/preferences/"))
      data = { effective: {}, inherited: {}, overrides: {}, revision: "one" };
    else if (path === "/api/radio/library/sync") {
      state.syncs++;
      return route.fulfill({ status: 202, body: "" });
    } else if (path === "/api/radio/library" && method === "PUT") {
      state.saved = route.request().postDataJSON();
      state.current = { ...chosen, synced_at: null, files: 0, linked: 0 };
      data = state.current;
    } else if (path === "/api/radio/library")
      data = {
        current: state.current,
        options: [
          {
            integration_id: "abs",
            server_name: "Home ABS",
            library_id: "podcasts",
            name: "Podcasts",
            folders: ["/podcasts"],
          },
          {
            integration_id: "abs",
            server_name: "Home ABS",
            library_id: "radio-lib",
            name: "Radio",
            folders: ["/radio"],
          },
        ],
        errors: [],
      };
    return route.fulfill({ json: data });
  });
  return state;
}

test("an admin chooses the radio library and reads it again", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/settings#libraries");
  const block = page.getByRole("region", { name: "Radio library" });
  await expect(
    block.getByRole("heading", { name: "Radio library" }),
  ).toBeVisible();
  const library = block.getByLabel("Podcast library and folder");
  await library.selectOption({ label: "Radio · Home ABS: /radio" });
  const folder = block.getByLabel("Same folder for Storyarr");
  await expect(folder).toHaveValue("/radio");
  await folder.fill("/media/radio");
  await block.getByRole("button", { name: "Save radio library" }).click();
  expect(state.saved).toEqual({
    integration_id: "abs",
    library_id: "radio-lib",
    abs_folder: "/radio",
    local_path: "/media/radio",
  });
  await expect(block.getByRole("status")).toHaveText(
    /^Saved at \d\d:\d\d\. Storyarr is reading it now\.$/,
  );
  await expect(block.getByText("Radio on Home ABS")).toBeVisible();
  await expect(block.getByText("Not read yet")).toBeVisible();

  state.current = chosen;
  await page.reload();
  await expect(
    block.getByText("12 episode files, 10 matched to your shows"),
  ).toBeVisible();
  await expect(block.getByText("2 November 2026")).toBeVisible();
  await block.getByRole("button", { name: "Read again" }).click();
  const toast = page.locator(".toast", {
    hasText: "Reading the radio library",
  });
  await expect(toast).toContainText("This takes a minute.");
  await expect(toast).toHaveAttribute("data-tone", "info");
  expect(state.syncs).toBe(1);

  await block.getByRole("button", { name: "Change" }).click();
  await expect(library).toHaveValue("abs|radio-lib|/radio");
  await expect(folder).toHaveValue("/media/radio");
  await block.getByRole("button", { name: "Cancel" }).click();
  await expect(block.getByRole("button", { name: "Read again" })).toBeVisible();
});

test("with no podcast library the radio library says what to do", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          user: {
            id: "user",
            role: "admin",
            display_name: "Reader",
            onboarding_status: "complete",
          },
          csrf_token: "test",
        },
      });
    if (path === "/api/setup/onboarding")
      return route.fulfill({ json: { status: "completed" } });
    if (path === "/api/radio/library")
      return route.fulfill({
        json: {
          current: null,
          options: [],
          errors: ["Could not read the podcast libraries on Home ABS."],
        },
      });
    return route.fulfill({ json: [] });
  });
  await page.goto("/settings#libraries");
  const block = page.getByRole("region", { name: "Radio library" });
  await expect(
    block.getByText("No podcast libraries yet. In Audiobookshelf"),
  ).toBeVisible();
  await expect(block.getByRole("alert")).toHaveText(
    "Could not read the podcast libraries on Home ABS.",
  );
});
