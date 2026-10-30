import { expect, test } from "../fixtures";

test("a loading bar shows while page data is slow, and goes away after", async ({
  page,
}) => {
  let release!: () => void;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/**", async (route) => {
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
    else if (path === "/api/requests") await slow;
    return route.fulfill({ json: data });
  });
  await page.goto("/requests");
  const bar = page.locator(".loading-bar");
  await expect(bar).toHaveAttribute("data-active", "true");
  await expect(bar.getByRole("status")).toHaveText("Loading");
  release();
  await expect(bar).not.toHaveAttribute("data-active", "true");
});
