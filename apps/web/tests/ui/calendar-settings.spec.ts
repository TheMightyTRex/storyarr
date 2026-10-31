import { expect, test } from "../fixtures";

function entry(title: string, author: string, extra: object = {}) {
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`;
  return {
    work_id: null,
    provider: "hardcover",
    external_id: title,
    title,
    authors: [author],
    cover_url: "/assets/storyarr-192.png",
    release_date: day,
    basis: "audiobook",
    followed: false,
    in_library: false,
    genres: ["fantasy"],
    state: null,
    ...extra,
  };
}

test("calendar Show settings hide sources and authors and show covers", async ({
  page,
}) => {
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
    else if (path === "/api/releases/calendar")
      data = {
        month: new URL(route.request().url()).searchParams.get("month"),
        genres: ["fantasy"],
        choices: ["fantasy"],
        items: [
          entry("Followed Book", "Ann Author", { followed: true }),
          entry("Genre Book", "Ben Writer"),
        ],
        undated: [],
        page: 1,
        has_more: false,
      };
    return route.fulfill({ json: data });
  });
  await page.goto("/discover?view=calendar");
  const day = page.locator("button.release-day").first();
  await expect(day).toHaveAccessibleName(/2 releases/);
  await expect(day.locator(".release-mark-cover")).toHaveCount(2);

  await page.getByRole("button", { name: /Show/ }).click();
  const panel = page.locator("#calendar-settings-panel");
  await panel.getByLabel("Hardcover releases in your genres").uncheck();
  await expect(day).toHaveAccessibleName(/1 release$/);
  await expect(page.getByText("1 release is hidden")).toBeVisible();

  await panel.getByLabel("Ann Author").uncheck();
  await expect(
    page.getByText("Nothing you have chosen to show is scheduled this month."),
  ).toBeVisible();

  await panel.getByRole("button", { name: "Show all" }).click();
  await panel.getByLabel("Hardcover releases in your genres").check();
  await panel.getByLabel("Show covers on the calendar").uncheck();
  await expect(day.locator(".release-mark-cover")).toHaveCount(0);

  // The choices are kept in this browser.
  await page.reload();
  await expect(
    page.locator("button.release-day").first().locator(".release-mark-cover"),
  ).toHaveCount(0);
});
