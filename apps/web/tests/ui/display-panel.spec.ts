import { expect, test, emptyDiscoveryHome } from "../fixtures";

test("Display and accessibility settings change the theme and reading aids, and reset", async ({
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
          id: "reader",
          role: "member",
          username: "reader",
          display_name: "Reader",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/library/libraries") data = [];
    return route.fulfill({ json: data });
  });
  await page.goto("/library");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).toHaveCSS("color-scheme", "light");
  const pageBackground = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );

  const header = page.locator("header.topbar");
  await expect(page.locator(".topbar-sticky")).toHaveCSS("position", "sticky");
  const rightmost = await header.evaluate((element) => {
    const items = [...element.querySelectorAll(".topbar-actions > *")]
      .map((item) => item.getBoundingClientRect())
      .filter((box) => box.width > 0);
    return Math.max(...items.map((box) => box.right));
  });
  const display = await page
    .getByRole("button", { name: "Display" })
    .boundingBox();
  expect(display!.x + display!.width).toBe(rightmost);
  await page.getByRole("button", { name: "Display" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Display and accessibility",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: "Dark" }).check();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveCSS("color-scheme", "dark");
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).not.toBe(pageBackground);

  await dialog.getByRole("radio", { name: "150%" }).check();
  await expect(html).toHaveCSS("font-size", "24px");
  for (const name of [
    "Low-vision font",
    "High contrast",
    "Reduce motion",
    "Underline links",
    "Wider text spacing",
  ])
    await dialog.getByRole("switch", { name: new RegExp(name) }).check();
  await expect(html).toHaveClass(
    /pref-readable.*pref-hc.*pref-calm.*pref-underline.*pref-spacing/,
  );
  await expect(dialog.getByRole("status")).toHaveText(
    "Wider text spacing activated.",
  );

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveClass(/pref-hc/);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Reset display settings" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).not.toHaveClass(/pref-/);
  await expect(html).toHaveCSS("font-size", "16px");
});
