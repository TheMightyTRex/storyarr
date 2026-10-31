import { expect, test } from "../fixtures";
import type { Page } from "@playwright/test";

async function mock(page: Page, saved: unknown[], upgrading = false) {
  let pace = "normal";
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
    else if (path === "/api/upgrade")
      data = {
        release: "2026.10.31.2",
        version: "0.4.2",
        acknowledged: upgrading ? "2026.10.31" : "2026.10.31.2",
        pending: upgrading,
        releases: upgrading
          ? [
              {
                id: "2026.10.31.2",
                title: "Background work",
                highlights: ["Choose how often scheduled jobs run."],
                review: [
                  {
                    id: "background-work",
                    title: "Background work",
                    description: "How often background jobs are checked.",
                    link: "/settings#background-work",
                  },
                ],
                database_changes: ["A new background_work_settings table."],
                rollback: "Downgrade to 0083_operation_lookups.",
              },
            ]
          : [],
        backups: [],
        automatic: false,
        automatic_from_environment: false,
      };
    else if (path === "/api/background-work") {
      if (request.method() === "PUT") {
        saved.push(request.postDataJSON());
        pace = (request.postDataJSON() as { pace: string }).pace;
      }
      data = { pace };
    }
    return route.fulfill({ json: data });
  });
}

test("admins choose how often background jobs run in Settings, System", async ({
  page,
}) => {
  const saved: unknown[] = [];
  await mock(page, saved);
  await page.goto("/settings#background-work");
  const section = page.getByRole("region", { name: "Background work" });
  await expect(section.getByRole("radio", { name: /^Normal/ })).toBeChecked();
  await section.getByRole("radio", { name: /^Minimal/ }).check();
  await section.getByRole("button", { name: "Save background work" }).click();
  await expect(section.getByRole("status")).toHaveText(
    "Background work saved. It applies within a minute.",
  );
  expect(saved).toEqual([{ pace: "minimal" }]);
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Background work" })
      .getByRole("radio", { name: /^Minimal/ }),
  ).toBeChecked();
});

test("the upgrade wizard offers Background work as a new setting", async ({
  page,
}) => {
  const saved: unknown[] = [];
  await mock(page, saved, true);
  await page.goto("/upgrade");
  await expect(
    page.getByRole("heading", { name: "Welcome to version 0.4.2" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Upgrade steps" })
    .getByRole("button", { name: /New settings/ })
    .click();
  await page.getByText("Background work", { exact: true }).first().click();
  const form = page.getByRole("form", { name: "Background work" });
  await form.getByRole("radio", { name: /^Light/ }).check();
  await form.getByRole("button", { name: "Save background work" }).click();
  await expect(form.getByRole("status")).toBeVisible();
  expect(saved).toEqual([{ pace: "light" }]);
});
