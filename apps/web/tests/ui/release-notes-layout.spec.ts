import { expect, test } from "../fixtures";

test("release notes read left to right in the Shelf layout, without a repeated title", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "book-search:display:v1",
      JSON.stringify({ layout: "shelf" }),
    ),
  );
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { items: [], total: 0, offset: 0, limit: 40 };
    if (path === "/api/auth/me")
      data = {
        user: { id: "a", role: "member", username: "a", display_name: "A" },
        csrf_token: "t",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/library/libraries") data = [];
    else if (path === "/api/application/release")
      data = {
        installed_version: "v0.4.0",
        installed_url: null,
        latest_version: "v0.4.0",
        release_url: null,
        update_available: false,
        status: "checked",
      };
    else if (path === "/api/application/releases")
      data = {
        installed_version: "v0.4.0",
        status: "checked",
        releases: [
          {
            version: "v0.4.0",
            name: "Storyarr v0.4.0",
            notes: [
              "# Storyarr v0.4.0",
              "",
              "## Following",
              "",
              "- A bookshelf page for each follow, with a",
              "  progress bar.",
            ].join("\n"),
            url: "https://github.com/example/releases/tag/v0.4.0",
            published_at: "2026-10-31T10:00:00Z",
          },
        ],
      };
    return route.fulfill({ json: data });
  });
  await page.goto("/library");
  await page.locator('button[title="Show release notes"]').click();
  const dialog = page.getByRole("dialog", { name: "Release notes" });
  // The notes start with "# Storyarr v0.4.0": the window shows the version once, as its heading.
  await expect(
    dialog.getByRole("heading", { name: "Storyarr v0.4.0" }),
  ).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: /^v0\.4\.0/ })).toHaveCount(
    1,
  );
  const item = dialog.getByRole("listitem");
  await expect(item).toHaveText(
    "A bookshelf page for each follow, with a progress bar.",
  );
  await expect(item).toHaveCSS("text-align", "left");
  await expect(dialog.getByRole("heading", { name: "Following" })).toHaveCSS(
    "font-weight",
    "650",
  );
});
