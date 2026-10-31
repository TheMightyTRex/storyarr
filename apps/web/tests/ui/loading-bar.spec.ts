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

test("the loading bar stays on while sources are searched, even between quick checks", async ({
  page,
}) => {
  const work = {
    id: "work-1",
    title: "The Long Earth",
    authors: ["Terry Pratchett", "Stephen Baxter"],
    versions: [],
    availability: { owned: false, ebook: false, audio: false, stale: false },
  };
  const profile = { id: null, generation: 0, preferences: {} };
  let status = "running";
  const search = () => ({
    id: "search-1",
    work_id: work.id,
    request_id: null,
    query: "The Long Earth",
    medium: "all",
    offset: 0,
    status,
    stale_identity: false,
    profile,
    sources: [],
    items: [],
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          role: "admin",
          username: "reader",
          display_name: "Reader",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/catalog/works/work-1") data = work;
    else if (path === "/api/acquisition/profiles") data = [profile];
    else if (path === "/api/acquisition/preferences/personal")
      data = { effective: {} };
    else if (path.includes("/quick-add/latest/")) data = null;
    else if (path.includes("/source-searches")) data = search();
    else if (path === "/api/metadata/works/work-1")
      data = {
        sources: [],
        conflicts: [],
        fields: {},
        versions: [],
        versions_total: 0,
      };
    else if (path.endsWith("/reader-match")) data = { book: null };
    else if (path.endsWith("/reader-details"))
      data = { authors: [], reviews: [] };
    else if (path.endsWith("/versions")) data = [];
    else if (path.includes("/group"))
      data = { items: [], groups: [], members: [] };
    else if (path === "/api/requests" || path === "/api/catalog/works")
      data = { items: [], total: 0 };
    await route.fulfill({ json: data });
  });
  await page.goto("/books/work-1?tab=sources");
  const bar = page.locator(".loading-bar");
  // Each status check answers at once; the running search keeps the bar on.
  await expect(bar).toHaveAttribute("data-active", "true");
  await page.waitForTimeout(2000);
  await expect(bar).toHaveAttribute("data-active", "true");
  status = "completed";
  await expect(bar).not.toHaveAttribute("data-active", "true");
  // A search that failed must not leave the bar on.
  status = "failed";
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Book download sources" }),
  ).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(bar).not.toHaveAttribute("data-active", "true");
});
