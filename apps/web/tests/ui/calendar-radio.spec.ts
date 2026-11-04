import { expect, test } from "../fixtures";

// Radio R4: episodes of followed shows on the release calendar. Every /api response is mocked.

function day(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date;
}
const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

test("followed radio shows put their broadcasts on the calendar (R4)", async ({
  page,
}) => {
  // Two days ahead, so the episode is still to come in every time zone.
  // Near the end of a month, two days back instead (then it is wanted).
  let ahead = day(2);
  if (ahead.getMonth() !== new Date().getMonth()) ahead = day(-2);
  const upcoming = ahead > new Date();
  const broadcast = `${iso(ahead)}T18:30:00Z`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
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
    else if (path === "/api/radio/shows/s1/artwork")
      return route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#0f7a74"/></svg>`,
      });
    else if (path === "/api/releases/calendar")
      data = {
        month: url.searchParams.get("month"),
        genres: [],
        choices: ["fantasy"],
        items: [
          {
            work_id: null,
            provider: "radio",
            external_id: "m00e5",
            title: "The Unbelievable Truth",
            authors: [],
            cover_url: "/api/radio/shows/s1/artwork",
            release_date: iso(ahead),
            basis: "unknown",
            followed: true,
            in_library: false,
            genres: [],
            state: upcoming ? "not_released" : "wanted",
            radio: {
              show_id: "s1",
              episode_id: "e5",
              show_title: "The Unbelievable Truth",
              episode_title: "Clocks, Snow and Marmalade",
              code: "S20E03",
              station: "BBC Radio 4",
              broadcast_at: broadcast,
              status: upcoming ? "not_released" : "wanted",
            },
          },
        ],
        undated: [],
        page: 1,
        has_more: false,
        warning:
          "Choose genres to see upcoming releases. Books you follow still show.",
      };
    return route.fulfill({ json: data });
  });
  await page.goto("/discover?view=calendar");
  await expect(
    page.getByText(/broadcasts of the radio shows you follow/),
  ).toBeVisible();
  const cell = page.locator(`#release-day-${iso(ahead)}`);
  await expect(cell).toHaveAccessibleName(/1 release/);
  await expect(cell.locator(".release-mark-cover--radio")).toHaveCount(1);
  await expect(cell).toContainText("The Unbelievable Truth");

  await cell.click();
  const panel = page.getByRole("dialog");
  const card = panel.locator(".release-day-card--radio");
  await expect(card).toContainText("S20E03 · Clocks, Snow and Marmalade");
  await expect(card).toContainText("BBC Radio 4 · ");
  const date = new Date(broadcast).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  });
  // Decision 4: the standard status words for an episode still to come.
  await expect(card).toContainText(
    upcoming ? `Not released · ${date}` : "Wanted",
  );
  await expect(card.getByRole("link")).toHaveAttribute(
    "href",
    "/library/radio/shows/s1?episode=e5",
  );
  // No "Request on release day" note: that is for books.
  await expect(panel.getByText(/Request on release day/)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Show settings can hide the radio shows.
  await page.getByRole("button", { name: /Show/ }).click();
  await page
    .locator("#calendar-settings-panel")
    .getByLabel("Radio shows you follow")
    .uncheck();
  await expect(page.getByText("1 release is hidden")).toHaveCount(0);
  await expect(
    page.getByText("Nothing you have chosen to show is scheduled this month."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
