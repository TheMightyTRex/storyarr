import { expect, test } from "../fixtures";

test("one bookshelf preserves filters and keeps library review for admins", async ({
  page,
}) => {
  const requests: URL[] = [];
  let role = "admin";
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    requests.push(url);
    let data: unknown = {};
    if (url.pathname === "/api/auth/me")
      data = {
        csrf_token: "test",
        user: {
          id: "reader",
          display_name: "Reader",
          role,
          onboarding_status: "complete",
        },
      };
    if (url.pathname === "/api/library/review") data = { items: [], total: 0 };
    if (url.pathname === "/api/library/review/summary")
      data = { total: 0, needs_matching: 0, read_issues: 0, reasons: [] };
    if (url.pathname === "/api/library/libraries") data = [];
    if (
      url.pathname === "/api/library/books" ||
      url.pathname === "/api/library/assets"
    )
      data = { items: [], total: 0 };
    if (url.pathname === "/api/catalog/works") data = { items: [], total: 80 };
    if (
      new URL(route.request().url()).pathname.includes(
        "/acquisition/preferences/",
      )
    )
      data = { effective: { desired_media: "both" } };
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await expect(page).toHaveURL(/\/library$/);
  await expect(
    page.getByRole("heading", { name: "My library", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Catalog", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Inventory state")).toHaveCount(0);
  await expect(page.getByLabel("Review queue")).toHaveCount(0);
  await page.getByRole("button", { name: "Audiobooks", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Sort", exact: true })
    .selectOption("recent");
  await page
    .getByRole("searchbox", { name: "Search your library" })
    .fill("Harbor");
  await page
    .getByRole("searchbox", { name: "Search your library" })
    .press("Enter");
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Sort", exact: true }),
  ).toHaveValue("recent");
  await expect(
    page.getByRole("button", { name: "Audiobooks", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("searchbox", { name: "Search your library" }),
  ).toHaveValue("Harbor");
  await page.goto("/review");
  await expect(
    page.getByRole("navigation", { name: "Review filter" }),
  ).toBeVisible();
  await expect(page.getByText("All caught up")).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Library review", exact: true }),
  ).toBeVisible();
  role = "member";
  await page.goto("/review");
  await expect(page).toHaveURL(/\/library$/);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: /^Library review/ }),
  ).toHaveCount(0);
  role = "admin";
  expect(requests.some((url) => url.pathname === "/api/library/books")).toBe(
    true,
  );
  await page.getByRole("link", { name: "My library", exact: true }).click();
  await page
    .getByRole("link", { name: "All saved titles", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add a title", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "My library" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
