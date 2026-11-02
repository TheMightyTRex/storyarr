import { expect, test } from "../fixtures";

test("cover size is chosen in Settings, saved with the account, and sizes My library", async ({
  page,
}) => {
  let preferences = {
    collection_view: "detail",
    library_views: {},
    cover_size: "medium",
  };
  const saved: unknown[] = [];
  const work = (index: number) => ({
    id: `00000000-0000-0000-0000-0000000004${String(index).padStart(2, "0")}`,
    title: `Book ${index}`,
    authors: ["Mara Ellison"],
    availability: { owned: true, ebook: false, audio: true, stale: false },
  });
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
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
    else if (path === "/api/library/libraries") data = [];
    else if (path === "/api/preferences") {
      if (request.method() === "PATCH") {
        saved.push(request.postDataJSON());
        preferences = { ...preferences, ...request.postDataJSON() };
      }
      data = preferences;
    } else if (path === "/api/library/books")
      data = {
        items: Array.from({ length: 8 }, (_, index) => work(index)),
        total: 8,
        offset: 0,
        limit: 40,
      };
    return route.fulfill({ json: data });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/library");
  const wall = page.locator(".shelf-wall");
  await expect(wall).toHaveAttribute("data-size", "medium");
  const medium = (await wall.locator(".cover-card").first().boundingBox())!
    .width;

  await page.goto("/settings#display");
  const sizes = page.getByRole("group", { name: "Cover size on My library" });
  await expect(sizes.getByRole("radio", { name: /Medium/ })).toBeChecked();
  await sizes.getByRole("radio", { name: /Large/ }).check();
  await expect.poll(() => saved).toEqual([{ cover_size: "large" }]);

  await page.goto("/library");
  await expect(wall).toHaveAttribute("data-size", "large");
  const large = (await wall.locator(".cover-card").first().boundingBox())!
    .width;
  expect(large).toBeGreaterThan(medium);
});
