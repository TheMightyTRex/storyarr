import { expect, test, emptyDiscoveryHome } from "../fixtures";

test("the Shelf layout groups library pages and can be switched back to Classic", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/discovery/home")
      return route.fulfill({ json: emptyDiscoveryHome() });
    let data: unknown = { items: [], total: 0, offset: 0, limit: 40 };
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "admin",
          role: "admin",
          username: "admin",
          display_name: "Admin",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/requests/counts") data = { active: 3 };
    else if (path === "/api/library/libraries") data = [];
    else if (path === "/api/library/review/summary") data = { total: 2 };
    return route.fulfill({ json: data });
  });

  await page.goto("/settings");
  const classic = page.getByRole("navigation", { name: "Main navigation" });
  await expect(classic.getByRole("link", { name: "My Library" })).toBeVisible();

  await page.getByText("Shelf", { exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "Layout changed to Shelf.",
  );
  const shelf = page.getByRole("navigation", { name: "Main navigation" });
  await expect(shelf.getByRole("link")).toHaveText([
    /Library/,
    /Discover/,
    /Activity/,
    /Settings/,
  ]);

  await shelf.getByRole("link", { name: /Library/ }).click();
  await expect(page).toHaveURL(/\/library$/);
  const tabs = page.getByRole("navigation", { name: "Library" });
  // In Shelf the library sub-menu sits in the header row under search, with square tabs.
  await expect(
    page.locator(".header-submenu").getByRole("navigation"),
  ).toHaveAccessibleName("Library");
  await expect(tabs.getByRole("link", { name: "My library" })).toHaveCSS(
    "border-radius",
    "0px",
  );
  await expect(tabs.locator("svg")).toHaveCount(3);
  await expect(tabs.getByRole("link", { name: "My library" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await tabs.getByRole("link", { name: "Following" }).click();
  await expect(page).toHaveURL(/\/following$/);
  await expect(shelf.getByRole("link", { name: /Library/ })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.reload();
  await expect(page.getByRole("navigation", { name: "Library" })).toBeVisible();

  await page.goto("/settings");
  await page.getByText("Classic", { exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "My Library" }),
  ).toBeVisible();
});

test("Settings has six groups in the header, each with its own section tabs", async ({
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
        user: {
          id: "admin",
          role: "admin",
          username: "admin",
          display_name: "Admin",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    return route.fulfill({ json: data });
  });
  await page.goto("/settings");
  const groups = page
    .locator(".header-submenu")
    .getByRole("navigation", { name: "Settings groups" });
  await expect(groups.getByRole("link")).toHaveText([
    "General",
    "Accounts",
    "Reading",
    "Library",
    "Downloads",
    "System",
  ]);
  await expect(groups.locator("svg")).toHaveCount(6);
  const sections = page.getByRole("navigation", {
    name: "Settings categories",
  });
  await expect(sections.getByRole("link")).toHaveText([
    "General",
    "Notifications",
  ]);
  await groups.getByRole("link", { name: "Downloads" }).click();
  await expect(page).toHaveURL(/#sources$/);
  await expect(groups.getByRole("link", { name: "Downloads" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(sections.getByRole("link")).toHaveText([
    "Download sources",
    "Download clients",
    "Download preferences",
    "Automation",
  ]);
});
