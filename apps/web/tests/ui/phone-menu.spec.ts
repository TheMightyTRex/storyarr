import { expect, test } from "../fixtures";

test("on phones the main menu is a drawer with each section's sub-menu", async ({
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
        installed_version: "v0.4.8",
        installed_url: null,
        latest_version: "v0.4.9",
        release_url: null,
        update_available: true,
        status: "checked",
      };
    return route.fulfill({ json: data });
  });

  // On a computer, the icon menu stays and there is no menu button.
  await page.goto("/library");
  await expect(page.locator(".shelf-rail")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Menu/ })).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".shelf-rail")).toBeHidden();
  // The red dot is on the menu button too, and its name says so.
  const button = page.getByRole("button", { name: "Menu, upgrade available" });
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("navigation", { name: "Main navigation" });
  await expect(menu.getByRole("button", { name: "Close menu" })).toBeFocused();
  // The section you are in starts open, with the page marked.
  await expect(menu.getByRole("button", { name: "Library" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(menu.getByRole("link", { name: "My library" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(menu.getByRole("link", { name: "Calendar" })).toBeHidden();
  await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();

  // Escape closes it and puts focus back on the menu button.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();

  // A press outside closes it too.
  await button.click();
  await page.mouse.click(380, 400);
  await expect(menu).toHaveCount(0);

  // Choosing a sub-menu page goes there and closes the menu.
  await button.click();
  await menu.getByRole("button", { name: "Discover" }).click();
  await menu.getByRole("link", { name: "Calendar" }).click();
  await expect(page).toHaveURL(/\/discover\?view=calendar$/);
  await expect(menu).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
