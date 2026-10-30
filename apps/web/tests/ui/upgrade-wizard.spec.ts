import { expect, test } from "../fixtures";

test("after an upgrade, admins get the wizard with release notes, backups and a way back", async ({
  page,
}) => {
  let acknowledged: string | null = null;
  const restores: unknown[] = [];
  const backup = {
    name: "settings-20261030-190000-before-upgrade.json",
    created_at: "2026-10-30T19:00:00Z",
    reason: "before-upgrade",
    size: 20480,
    rows: { metadata_settings: 1, libraries: 1 },
  };
  const view = () => ({
    release: "2026.10.30",
    acknowledged,
    pending: acknowledged !== "2026.10.30",
    releases: acknowledged
      ? []
      : [
          {
            id: "2026.10.30",
            title: "Layout, light theme, bookshelves and smarter searching",
            highlights: ["A choice of layout.", "Settings in six groups."],
            review: [
              {
                id: "audible-store",
                title: "Audible store",
                description: "The Audible store used for Audible search.",
                link: "/settings#catalog",
              },
            ],
          },
        ],
    backups: [backup],
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: unknown = { items: [], total: 0, offset: 0, limit: 40 };
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "admin",
          role: "admin",
          username: "admin",
          display_name: "Admin",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/library/libraries") data = [];
    else if (path === "/api/upgrade") data = view();
    else if (path === "/api/upgrade/acknowledge") {
      acknowledged = "2026.10.30";
      data = view();
    } else if (path.endsWith("/restore")) {
      restores.push({ path, body: request.postDataJSON() });
      data = {
        backup_taken: "settings-20261030-191000-before-restore.json",
        tables: {},
      };
    }
    return route.fulfill({ json: data });
  });

  // Any page opens the wizard while the upgrade is not finished.
  await page.goto("/library");
  await expect(page).toHaveURL(/\/upgrade$/);
  await expect(
    page.getByRole("heading", { name: "Welcome to the new version" }),
  ).toBeVisible();
  await expect(page.getByText("Settings in six groups.")).toBeVisible();

  const steps = page.getByRole("navigation", { name: "Upgrade steps" });
  await steps.getByRole("button", { name: /Your backup/ }).click();
  await expect(
    page.getByRole("heading", { name: "Your backup" }),
  ).toBeFocused();
  await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute(
    "href",
    `/api/upgrade/backups/${backup.name}`,
  );
  // Restoring is offered on the last step, not here.
  await expect(
    page.getByRole("button", { name: "Restore settings" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Next step" }).click();
  await expect(
    page.getByRole("link", { name: "Open Audible store settings" }),
  ).toHaveAttribute("href", "/settings#catalog");
  await page.getByRole("button", { name: "Next step" }).click();
  await page.getByRole("button", { name: "Restore settings" }).click();
  const confirm = page.getByRole("group", { name: "Confirm restore" });
  await expect(confirm).toContainText("user accounts or passwords");
  await confirm.getByRole("button", { name: "Restore settings" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Settings restored" }),
  ).toBeVisible();
  expect(restores).toEqual([
    {
      path: `/api/upgrade/backups/${backup.name}/restore`,
      body: { confirm: true },
    },
  ]);

  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page).toHaveURL(/\/library$/);
  expect(acknowledged).toBe("2026.10.30");
});

test("Remind me later hides the wizard until the tab closes", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { items: [], total: 0, offset: 0, limit: 40 };
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "admin",
          role: "admin",
          username: "admin",
          display_name: "Admin",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/library/libraries") data = [];
    else if (path === "/api/upgrade")
      data = {
        release: "2026.10.30",
        acknowledged: null,
        pending: true,
        releases: [],
        backups: [],
      };
    return route.fulfill({ json: data });
  });
  await page.goto("/upgrade");
  await page.getByRole("button", { name: "Remind me later" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await page.goto("/discover");
  await expect(page).toHaveURL(/\/discover$/);
});
