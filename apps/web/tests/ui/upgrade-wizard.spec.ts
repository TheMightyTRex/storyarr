import { expect, test } from "../fixtures";

test("after an upgrade, admins get the wizard; the way back is in Settings", async ({
  page,
}) => {
  let acknowledged: string | null = null;
  const restores: unknown[] = [];
  let saved: unknown = null;
  const backup = {
    name: "settings-20261030-190000-before-upgrade.json",
    created_at: "2026-10-30T19:00:00Z",
    reason: "before-upgrade",
    size: 20480,
    rows: { metadata_settings: 1, libraries: 1 },
  };
  const view = () => ({
    release: "2026.10.30",
    version: "0.4.0",
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
    automatic: false,
    automatic_from_environment: false,
    way_back: {
      title: "Layout, light theme, bookshelves and smarter searching",
      database_changes: ["New automation settings."],
      rollback: "Run python -m app.downgrade 0080_member_setup first.",
    },
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
    else if (path === "/api/metadata/preferences") {
      if (request.method() === "PUT") saved = request.postDataJSON();
      data = saved ?? {
        primary: "hardcover",
        language: "en",
        audible_region: null,
      };
    } else if (path === "/api/upgrade/acknowledge") {
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
    page.getByRole("heading", { name: "Welcome to version 0.4.0" }),
  ).toBeVisible();
  await expect(page.getByText("Settings in six groups.")).toBeVisible();

  const steps = page.getByRole("navigation", { name: "Upgrade steps" });
  // On a narrow screen the step list scrolls away rather than covering the step.
  await page.setViewportSize({ width: 800, height: 700 });
  await expect(steps).toHaveCSS("position", "static");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(steps).toHaveCSS("position", "sticky");
  await steps.getByRole("button", { name: /Your backup/ }).click();
  await expect(
    page.getByRole("heading", { name: "Your backup" }),
  ).toBeFocused();
  await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute(
    "href",
    `/api/upgrade/backups/${backup.name}`,
  );
  // Restoring is in Settings, not in the wizard.
  await expect(
    page.getByRole("button", { name: "Restore settings" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Restore previous version" }),
  ).toHaveAttribute("href", "/settings#upgrades");

  await page.getByRole("button", { name: "Next step" }).click();
  // New settings open in place, so changing one does not leave the wizard.
  await page.getByText("Audible store", { exact: true }).click();
  const store = page.getByRole("form", { name: "Audible store" });
  await store.getByRole("combobox").selectOption("uk");
  await store.getByRole("button", { name: "Save Audible store" }).click();
  await expect(store.getByRole("status")).toHaveText("Audible store saved.");
  expect(saved).toMatchObject({ primary: "hardcover", audible_region: "uk" });
  await expect(page).toHaveURL(/\/upgrade$/);
  // New settings are the last step: there is no way-back step any more.
  await expect(page.getByRole("button", { name: "Next step" })).toHaveCount(0);
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  expect(acknowledged).toBe("2026.10.30");

  // Settings, System, Upgrades and backups: Restore previous version.
  await page.goto("/settings#upgrades");
  await page.getByText("Restore previous version", { exact: true }).click();
  await expect(page.getByText("New automation settings.")).toBeVisible();
  await expect(
    page.getByText("Run python -m app.downgrade 0080_member_setup first."),
  ).toBeVisible();
  // The wizard is finished, so Settings no longer links to it.
  await expect(
    page.getByRole("link", { name: "Open the upgrade wizard" }),
  ).toHaveCount(0);
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

test("Keep the defaults and finish takes a backup and closes the wizard", async ({
  page,
}) => {
  let accepted = false;
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
    else if (path === "/api/upgrade/automatic") accepted = true;
    if (path === "/api/upgrade" || path === "/api/upgrade/automatic")
      data = {
        release: "2026.10.30",
        acknowledged: accepted ? "2026.10.30" : null,
        pending: !accepted,
        releases: [],
        backups: [],
        automatic: false,
        automatic_from_environment: false,
      };
    return route.fulfill({ json: data });
  });
  await page.goto("/upgrade");
  await page
    .getByRole("button", { name: "Keep the defaults and finish" })
    .click();
  await expect(page).toHaveURL(/\/library$/);
  expect(accepted).toBe(true);
});
