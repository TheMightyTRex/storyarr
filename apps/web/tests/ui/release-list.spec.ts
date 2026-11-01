import { expect, test } from "../fixtures";

test("Settings lists every release in folds, with the installed one open", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { items: [], total: 0, offset: 0, limit: 40 };
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "admin",
          role: "admin",
          username: "alex",
          display_name: "Alex",
          permissions: [],
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/library/libraries") data = [];
    else if (path === "/api/application/release")
      data = {
        installed_version: "v0.4.7",
        installed_url: null,
        latest_version: "v0.4.8",
        release_url: null,
        update_available: true,
        status: "checked",
      };
    else if (path === "/api/application/releases")
      data = {
        installed_version: "v0.4.7",
        status: "checked",
        releases: ["v0.4.8", "v0.4.7", "v0.4.6"].map((version, index) => ({
          version,
          name: `Storyarr ${version}`,
          notes: `## Changed\n\n- Notes for ${version}`,
          url: `https://github.com/example/releases/tag/${version}`,
          published_at: `2026-11-0${3 - index}T10:00:00Z`,
          prerelease: false,
        })),
      };
    return route.fulfill({ json: data });
  });
  await page.goto("/settings#upgrades");
  await page.getByText("Releases", { exact: true }).click();
  const folds = page.locator(".release-fold");
  await expect(folds).toHaveCount(3);
  // Newest first; the installed version is marked and starts open; the newer one says Available.
  await expect(folds.nth(0)).toContainText("v0.4.8");
  await expect(folds.nth(0)).toContainText("Available");
  await expect(folds.nth(0)).not.toHaveAttribute("open");
  await expect(folds.nth(1)).toContainText("Current version");
  await expect(folds.nth(1)).toHaveAttribute("open");
  await expect(page.getByText("Notes for v0.4.7")).toBeVisible();
  // Any release opens to its notes.
  await folds.nth(2).locator("summary").click();
  await expect(page.getByText("Notes for v0.4.6")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View v0.4.6 on GitHub" }),
  ).toHaveAttribute("href", "https://github.com/example/releases/tag/v0.4.6");
});
