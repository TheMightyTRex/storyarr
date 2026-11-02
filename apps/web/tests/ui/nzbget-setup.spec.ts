import { expect, test, type Page } from "../fixtures";

// NZBGet sits beside SABnzbd for Usenet, in Settings and in the onboarding wizard (which reuses the
// same Download clients section).
async function mockApi(page: Page, onboarding: { status: string; step?: number }) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.fallback();
    let data: unknown = [];
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "admin",
          role: "admin",
          display_name: "Reader",
          onboarding_status: onboarding.status === "completed" ? "complete" : "pending",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = onboarding;
    else if (path === "/api/setup/readiness")
      data = { download_dispatch_enabled: false, downloaders: [] };
    return route.fulfill({ json: data });
  });
}

async function expectNzbgetForm(page: Page) {
  await page.getByRole("button", { name: "Connect NZBGet", exact: true }).click();
  const form = page.getByRole("dialog").or(page.locator("form").filter({ hasText: "NZBGet" })).first();
  await expect(form.getByRole("textbox").first()).toHaveAttribute("placeholder", "http://nzbget:6789");
  await expect(form.getByText(/username/i).first()).toBeVisible();
  await expect(form.getByText(/password/i).first()).toBeVisible();
  await expect(form.getByText(/category/i).first()).toBeVisible();
}

test("Settings offers NZBGet next to SABnzbd, with its own sign-in fields", async ({ page }) => {
  await mockApi(page, { status: "completed" });
  await page.goto("/settings#downloaders");
  await expect(page.getByRole("button", { name: "Connect SABnzbd", exact: true })).toBeVisible();
  await expectNzbgetForm(page);
});

test("the onboarding wizard's download client step offers NZBGet", async ({ page }) => {
  // Admin steps: catalog, libraries, sources, downloaders (index 3).
  await mockApi(page, { status: "in_progress", step: 3 });
  await page.goto("/getting-started");
  await expect(page.getByRole("heading", { name: "Download clients" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect SABnzbd", exact: true })).toBeVisible();
  await expectNzbgetForm(page);
});
