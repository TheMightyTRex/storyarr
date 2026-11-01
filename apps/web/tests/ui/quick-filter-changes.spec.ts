import { expect, test } from "../fixtures";

// Every filter starts from the address as it is now (currentParams), so two changes made before the
// page redraws both stick. Before, the second change could drop the first.
test("two filter changes in a row both stick", async ({ page }) => {
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
          id: "reader",
          role: "admin",
          username: "reader",
          display_name: "Reader",
          permissions: [],
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/library/libraries") data = [];
    return route.fulfill({ json: data });
  });
  await page.goto("/library");
  const sort = page.getByRole("combobox", { name: "Sort", exact: true });
  await expect(sort).toBeVisible();
  // Both changes in the same moment, with no redraw in between.
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Audiobooks",
    )!;
    const select = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Sort"]',
    )!;
    chip.click();
    select.value = "recent";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page).toHaveURL(/medium=audio/);
  await expect(page).toHaveURL(/sort=recent/);
  await expect(
    page.getByRole("button", { name: "Audiobooks", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
