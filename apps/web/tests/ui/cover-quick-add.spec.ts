import { expect, test, emptyDiscoveryHome } from "../fixtures";

test("cover actions get missing formats without navigating, including provider imports", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const writes: { work_id: string; specification: { mode?: string } }[] = [];
  const imports: string[] = [];
  const libraryCoverReads: string[] = [];
  let role = "admin";
  let fail = false;
  let queued = false;
  const art = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#7d4938"/><text x="20" y="90" fill="white" font-size="22">A NEW WORLD</text></svg>')}`;
  const items = ["missing", "ebook-owned", "complete", "provider"].map(
    (id, i) => ({
      book: {
        provider: "hardcover",
        external_id: id,
        title: id,
        authors: ["Test Author"],
        cover_url: art,
        rating: id === "complete" ? null : 4.25,
      },
      work:
        i === 3
          ? null
          : {
              id,
              title: id,
              authors: ["Test Author"],
              cover_url: art,
              availability: {
                owned: i > 0,
                ebook: i > 0,
                audio: i === 2,
                primary_ebook_version_id: i > 0 ? "edition" : null,
                primary_ebook_selected: i === 2,
              },
            },
    }),
  );
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/discovery/home")
      return route.fulfill({ json: emptyDiscoveryHome() });
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          username: "reader",
          display_name: "Reader",
          role,
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/metadata/account") data = { enabled: true };
    else if (path.endsWith("/cover")) {
      libraryCoverReads.push(path);
      return route.fulfill({ status: 404 });
    } else if (path === "/api/discovery/hardcover/trending")
      data = { title: "Trending on Hardcover", status: "ready", items };
    else if (path.startsWith("/api/discovery/"))
      data = { title: "Other books", status: "ready", items: [], total: 0 };
    else if (path === "/api/acquisition/preferences/personal")
      data = { effective: { desired_media: "both" } };
    else if (path.includes("/quick-add/latest/")) data = null;
    else if (path.endsWith("/import")) {
      imports.push(path);
      data = { id: "imported" };
    } else if (path === "/api/requests/quick-add") {
      writes.push(route.request().postDataJSON());
      if (fail)
        return route.fulfill({
          status: 503,
          json: { detail: "Please retry download" },
        });
      data = {
        id: "receipt",
        status: queued ? "queued" : "completed",
        message: queued ? "Searching for releases" : "Downloads queued",
      };
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/discover");
  await expect(page.locator(".cover-rating")).toHaveCount(3);
  await expect(page.locator(".cover-rating").first()).toHaveText("4.3");
  const card = (title: string) =>
    page.locator(".cover-card").filter({
      has: page.getByRole("button", { name: `${title}, details`, exact: true }),
    });
  const missing = card("missing");
  const owned = card("ebook-owned");
  const complete = card("complete");
  const provider = card("provider");
  await expect(missing).toBeVisible();
  await expect(owned.locator(".book-cover img")).toHaveAttribute("src", art);
  await expect(complete.locator(".book-cover img")).toHaveAttribute("src", art);
  // Automatic edition selection must not block public artwork behind the library.
  // An explicitly selected edition still gets its library image first.
  expect(libraryCoverReads).toEqual(["/api/catalog/works/complete/cover"]);
  // The old badges along the bottom of the cover are gone: the icons carry that status.
  await expect(page.locator(".cover-formats, .cover-owned")).toHaveCount(0);
  await expect(missing.locator(".cover-actions")).toHaveCSS("opacity", "0");
  await missing.hover();
  await expect(missing.locator(".cover-actions")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("cover-hover.png") });
  // More holds Quick add with the saved choice, and Get both formats.
  await missing.getByRole("button", { name: "More for missing" }).click();
  await page
    .getByRole("menuitem", { name: "Quick add · Ebook + audiobook" })
    .click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ work_id: "missing", specification: {} });
  await expect(page).toHaveURL(/\/discover$/);
  await missing
    .getByRole("button", { name: "Get the ebook of missing", exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].specification).toEqual({ mode: "ebook" });
  // A format in the library: a tick on its icon and "in library" in its name.
  await owned.getByRole("button", { name: "ebook-owned, details" }).focus();
  const ownedEbook = owned.getByRole("button", {
    name: "Ebook of ebook-owned in library",
  });
  await expect(ownedEbook.locator(".cover-actions__tick")).toBeVisible();
  await owned
    .getByRole("button", {
      name: "Get the audiobook of ebook-owned",
      exact: true,
    })
    .click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2]).toEqual({
    work_id: "ebook-owned",
    specification: { mode: "audio" },
  });
  await complete.hover();
  await expect(complete.getByRole("button", { name: /^Get the / })).toHaveCount(
    0,
  );
  fail = true;
  await provider.hover();
  await provider
    .getByRole("button", { name: "Get the audiobook of provider", exact: true })
    .click();
  await expect(provider.getByRole("alert")).toHaveText("Retry needed");
  await expect(provider.getByRole("alert")).toHaveAttribute(
    "title",
    "Please retry download",
  );
  fail = false;
  queued = true;
  await provider
    .getByRole("button", { name: "Get the audiobook of provider", exact: true })
    .click();
  await expect(
    provider.getByRole("button", {
      name: "Get the audiobook of provider",
      exact: true,
    }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(provider.locator(".cover-card__status")).toHaveText(
    "Searching…",
  );
  expect(imports).toHaveLength(1);
  expect(writes.at(-1)).toEqual({
    work_id: "imported",
    specification: { mode: "audio" },
  });
  expect(await page.locator("a button").count()).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("cover-mobile.png"),
    fullPage: true,
  });
  role = "viewer";
  await page.reload();
  await expect(missing).toBeVisible();
  await expect(page.getByRole("button", { name: /^Get the / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /to a list$/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("cover actions leave out Quick add when no format choice is saved", async ({
  page,
}) => {
  const writes: unknown[] = [];
  const art = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#243044"/><text x="16" y="150" fill="white" font-size="18">COVER</text></svg>')}`;
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/discovery/home")
      return route.fulfill({ json: emptyDiscoveryHome() });
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { items: [], total: 0 };
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          username: "reader",
          display_name: "Reader",
          role: "admin",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/metadata/account") data = { enabled: true };
    else if (path.endsWith("/cover")) return route.fulfill({ status: 404 });
    else if (path === "/api/discovery/hardcover/trending")
      data = {
        title: "Trending on Hardcover",
        status: "ready",
        items: [
          {
            book: {
              provider: "hardcover",
              external_id: "unset",
              title: "Unset preference",
              authors: ["Test Author"],
              cover_url: art,
            },
            work: {
              id: "unset",
              title: "Unset preference",
              authors: ["Test Author"],
              cover_url: art,
              availability: { owned: false, ebook: false, audio: false },
            },
          },
        ],
      };
    else if (path.startsWith("/api/discovery/"))
      data = { title: "Other books", status: "ready", items: [], total: 0 };
    else if (path === "/api/acquisition/preferences/personal")
      data = { effective: { desired_media: null } };
    else if (path.includes("/quick-add/latest/")) data = null;
    else if (path === "/api/requests/quick-add") {
      writes.push(route.request().postDataJSON());
      data = {
        id: "receipt",
        status: "completed",
        message: "Downloads queued",
      };
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/discover");
  const card = page.locator(".cover-card").filter({
    has: page.getByRole("button", { name: "Unset preference, details" }),
  });
  await card.hover();
  await card.getByRole("button", { name: "More for Unset preference" }).click();
  // Without a saved choice, More offers the formats but not Quick add with the saved choice.
  await expect(page.getByRole("menuitem", { name: /^Quick add/ })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await card
    .getByRole("button", {
      name: "Get the ebook of Unset preference",
      exact: true,
    })
    .click();
  await expect.poll(() => writes.length).toBe(1);
});
