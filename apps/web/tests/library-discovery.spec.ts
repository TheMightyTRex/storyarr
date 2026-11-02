import { expect, test } from "./fixtures";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("recent library additions show confirmed holdings and recover from shelf failures", async ({
  page,
}, testInfo) => {
  execFileSync("uv", ["run", "python", "scripts/e2e_auth_budget.py"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    stdio: "pipe",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("reader");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser test password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.goto("/library?view=saved");
  await expect(page.getByRole("heading", { name: "My library" })).toBeVisible();
  const actual = await (
    await page.request.get("/api/discovery/library")
  ).json();
  expect(actual.items.length).toBeGreaterThan(0);
  const first = actual.items[0].work;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
      writes.push(request.url());
  });
  let outage = false;
  // Preserve actual holdings. Override only has_more so this small fixture
  // exercises page navigation; API tests qualify real pagination boundaries.
  const queries: URLSearchParams[] = [];
  await page.route("**/api/discovery/library?*", async (route) => {
    queries.push(new URL(route.request().url()).searchParams);
    if (outage) {
      await route.fulfill({
        status: 503,
        json: { detail: "Synthetic library shelf outage" },
      });
      return;
    }
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, has_more: body.page === 1 },
    });
  });
  await page.getByRole("link", { name: "Discover", exact: true }).click();
  const shelf = page.getByRole("region", {
    name: "Recent library additions",
    exact: true,
  });
  // Pressing a cover opens the book's Summary; a format in the library has "in library" in its action.
  const book = shelf.getByRole("button", {
    name: `${first.title}, details`,
    exact: true,
  });
  await expect(
    shelf
      .locator(".cover-card")
      // A filter's inner locator is read inside each card, so it cannot start from the shelf.
      .filter({
        has: page.getByRole("button", {
          name: `${first.title}, details`,
          exact: true,
        }),
      })
      .getByRole("button", { name: / in library$/ })
      .first(),
  ).toBeAttached();
  await expect(shelf.getByText(/Library copy first observed/)).toHaveCount(0);
  await shelf.locator(".discovery-shelf").evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });

  await expect
    .poll(() => queries.some((q) => q.get("page") === "2"))
    .toBe(true);
  expect(queries.at(-1)?.get("page")).toBe("2");
  await shelf
    .getByRole("combobox", { name: "Show library additions" })
    .selectOption("audio");
  await expect.poll(() => queries.at(-1)?.get("medium")).toBe("audio");
  expect(queries.at(-1)?.get("medium")).toBe("audio");
  for (const item of await shelf.locator(".cover-card").all())
    await expect(
      item.getByRole("button", { name: /^Audiobook of .* in library$/ }),
    ).toBeAttached();
  await shelf
    .getByRole("combobox", { name: "Show library additions" })
    .selectOption("ebook");
  await expect.poll(() => queries.at(-1)?.get("medium")).toBe("ebook");
  expect(queries.at(-1)?.get("medium")).toBe("ebook");
  for (const item of await shelf.locator(".cover-card").all())
    await expect(
      item.getByRole("button", { name: /^Ebook of .* in library$/ }),
    ).toBeAttached();
  await shelf.screenshot({
    path: testInfo.outputPath("recent-library-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await shelf.screenshot({
    path: testInfo.outputPath("recent-library-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  outage = true;
  await shelf
    .getByRole("combobox", { name: "Show library additions" })
    .selectOption("any");
  await expect(
    shelf.getByText("Synthetic library shelf outage", { exact: true }),
  ).toBeVisible();
  await expect(shelf.locator(".cover-card")).toHaveCount(0);
  outage = false;
  await shelf.getByRole("button", { name: "Retry library shelf" }).click();
  await expect(book).toBeVisible();
  await book.focus();
  await page.keyboard.press("Enter");
  const bookPage = page
    .getByRole("dialog", { name: /Summary/ })
    .getByRole("link", { name: "Open book page" });
  await bookPage.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: first.title, exact: true, level: 1 }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});
