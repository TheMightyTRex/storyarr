import { expect, test } from "../fixtures";

test("each page names the browser tab after its main heading", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
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
  await expect(page).toHaveTitle("My library · Storyarr");
  await page.goto("/settings");
  await expect(page).toHaveTitle(/· Storyarr$/);
  await expect(page).not.toHaveTitle("My library · Storyarr");
});
