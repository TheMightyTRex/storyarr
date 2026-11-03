import { expect, test } from "../fixtures";

test("Send feedback opens Snaglist, which leaves the signed-in name out", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          role: "member",
          display_name: "Private Reader",
          permissions: [],
          access_label: "Member",
          onboarding_status: "complete",
        },
        csrf_token: "test",
      };
    if (path === "/api/setup/onboarding") data = { status: "completed" };
    if (path === "/api/application/release")
      data = {
        installed_version: "v1.9.0",
        installed_url: null,
        latest_version: "v1.9.0",
        release_url: null,
        update_available: false,
        upgrade_url: null,
        status: "checked",
      };
    if (path.includes("/acquisition/preferences/"))
      data = { effective: { desired_media: "both" } };
    return route.fulfill({ json: data });
  });
  await page.goto("/settings");
  const send = page.getByRole("button", { name: "Send feedback" }).first();
  await expect(send).toBeVisible();
  // Snaglist is not loaded until someone asks for it.
  expect(await page.evaluate(() => "Snaglist" in window)).toBe(false);
  await send.click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Report a problem");
  // British English, as the rest of Storyarr.
  await expect(dialog).toContainText("wrong colour or size");
  expect(
    await page.evaluate(() => window.Snaglist?.version.length ?? 0),
  ).toBeGreaterThan(0);
  // The signed-in name is marked private, so no report can hold it.
  await expect(
    page.locator("[data-snag-private]", { hasText: "Private Reader" }).first(),
  ).toBeAttached();
});
