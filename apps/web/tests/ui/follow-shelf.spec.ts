import { expect, test } from "../fixtures";

const list = "00000000-0000-0000-0000-0000000000a1";
const book = (n: number, title: string, kind: string, label: string) => ({
  work_id: `00000000-0000-0000-0000-00000000010${n}`,
  external_id: String(n),
  title,
  authors: ["Barry J. Hutchison"],
  cover_url: null,
  release_date: "2020-01-0" + n,
  upcoming: false,
  included: kind !== "excluded",
  ebook: false,
  audio: kind === "in_library",
  stale: false,
  follow_names: ["Space Team"],
  status: { kind, label, detail: kind === "wanted" ? "Added by hand" : null },
});

test("a followed series opens as a bookshelf with progress, status chips and a book drawer", async ({
  page,
}) => {
  const statusQueries: (string | null)[] = [];
  await page.route("**/api/**", (route) => {
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
    else if (path === `/api/following/${list}/summary`)
      data = {
        list_id: list,
        source_kind: "series",
        external_id: "77",
        name: "Space Team",
        image_url: null,
        followed_at: "2026-10-01T00:00:00Z",
        enabled: true,
        state: "succeeded",
        complete: true,
        last_success_at: "2026-10-30T00:00:00Z",
        mode: "automatic",
        active: true,
        latest_books: [],
      };
    else if (path === `/api/following/${list}/books`) {
      if (url.searchParams.get("limit") !== "1")
        statusQueries.push(url.searchParams.get("status"));
      const items = [
        book(1, "Space Team", "in_library", "In library"),
        book(2, "The Wrath of Vajazzle", "in_library", "In library"),
        book(3, "The Hunt for Reduk Topa", "wanted", "Wanted"),
        book(4, "The Holiday Special", "excluded", "Excluded"),
      ].filter(
        (item) =>
          !url.searchParams.get("status") ||
          item.status.kind === url.searchParams.get("status"),
      );
      data = {
        items,
        total: items.length,
        offset: 0,
        limit: 48,
        status_counts: { in_library: 2, wanted: 1, excluded: 1 },
      };
    }
    return route.fulfill({ json: data });
  });

  await page.goto(`/following/${list}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Space Team" }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", {
      name: "2 of 3 released books in your library",
    }),
  ).toBeVisible();
  await expect(page.getByText("· 1 excluded")).toBeVisible();

  const wall = page.getByRole("list", { name: "Space Team books" });
  await expect(wall.getByRole("listitem")).toHaveCount(4);
  const wanted = wall.getByRole("button", {
    name: "The Hunt for Reduk Topa, Wanted",
  });
  await wanted.click();
  const drawer = page.getByRole("complementary", {
    name: "The Hunt for Reduk Topa",
  });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("heading", { name: "The Hunt for Reduk Topa" }),
  ).toBeFocused();
  await expect(drawer.getByText("Added by hand")).toBeVisible();
  await expect(
    drawer.getByRole("link", { name: "Open book page" }),
  ).toHaveAttribute("href", "/books/00000000-0000-0000-0000-000000000103");
  await expect(
    drawer.getByRole("link", { name: "Open in Activity" }),
  ).toHaveAttribute("href", "/requests");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(wanted).toBeFocused();

  await page
    .getByRole("group", { name: "Show books by status" })
    .getByRole("button", { name: /Excluded/ })
    .click();
  await expect(wall.getByRole("listitem")).toHaveCount(1);
  expect(statusQueries).toContain("excluded");
});
