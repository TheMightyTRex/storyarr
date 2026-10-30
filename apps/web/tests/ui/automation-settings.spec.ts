import { expect, test } from "../fixtures";

test("Wanted books settings turn repeat searches on or off for each format", async ({
  page,
}) => {
  const saved: Record<string, unknown>[] = [];
  const filters = {
    fiction: true,
    non_fiction: true,
    comics: false,
    plays: false,
    companions: false,
  };
  let settings = {
    follow_filters: filters,
    missing_media: null,
    wanted_search: { enabled: true, audio: true, ebook: true },
  };
  let generation = 1;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
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
    else if (path === "/api/automation/settings") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON();
        saved.push(body);
        settings = { ...settings, wanted_search: body.wanted_search };
        generation += 1;
      }
      data = { settings, built_in: settings, generation };
    }
    return route.fulfill({ json: data });
  });
  await page.goto("/settings?group=wanted-search#automation");
  const form = page.getByRole("form", { name: "Wanted books" });
  await expect(form).toBeVisible();
  const again = form.getByRole("checkbox", {
    name: "Search again for wanted books",
  });
  await expect(again).toBeChecked();
  const save = form.getByRole("button", { name: "Save wanted books settings" });
  await expect(save).toBeDisabled();

  await form.getByRole("checkbox", { name: "Ebooks" }).uncheck();
  await save.click();
  await expect(form.getByRole("status")).toHaveText(
    "Wanted books settings saved.",
  );
  expect(saved.at(-1)).toEqual({
    wanted_search: { enabled: true, audio: true, ebook: false },
    expected_generation: 1,
  });

  // With repeat searches off, the format choices cannot be changed.
  await again.uncheck();
  await expect(
    form.getByRole("checkbox", { name: "Audiobooks" }),
  ).toBeDisabled();
  await save.click();
  expect(saved.at(-1)).toMatchObject({
    wanted_search: { enabled: false },
    expected_generation: 2,
  });
});
