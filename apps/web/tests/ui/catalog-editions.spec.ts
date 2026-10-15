import { expect, test } from "../fixtures";

for (const view of ["discovery", "saved", "unlinked"] as const) {
  test(`${view} edition filters retain the reported audiobook and explain partial results`, async ({
    page,
  }) => {
    page.on("pageerror", (error) => {
      throw error;
    });
    const id = "00000000-0000-0000-0000-000000000042";
    const title = "Tress of the Emerald Sea";
    const audio = {
      external_id: "31639613",
      id: "audio",
      title: "Tress Graphic Audio",
      medium: "audio",
      identifiers: { isbn_13: "9798890553157" },
      narrators: [],
      language: null,
      publisher: "Graphic Audio LLC",
      owned: false,
    };
    const editions = [
      ...Array.from({ length: 21 }, (_, i) => ({
        id: `print-${i}`,
        external_id: String(i + 1),
        title: `Print edition ${i + 1}`,
        medium: "print",
        narrators: [],
        identifiers: {},
        owned: false,
      })),
      audio,
    ];
    const book = {
      provider: "hardcover",
      external_id: "602482",
      title,
      authors: ["Brandon Sanderson"],
      editions,
      editions_more: true,
      series: [],
    };
    const work = {
      id,
      title,
      authors: book.authors,
      provisional: false,
      availability: {
        owned: false,
        ebook: false,
        audio: false,
        stale: false,
        in_collection: false,
      },
    };
    const requests: URL[] = [];
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      let data: unknown = [];
      if (url.pathname === "/api/auth/me")
        data = {
          user: {
            id: "reader",
            role: "member",
            display_name: "Reader",
            onboarding_status: "complete",
          },
          csrf_token: "test",
        };
      else if (url.pathname === "/api/setup/onboarding")
        data = { status: "completed" };
      else if (url.pathname.startsWith("/api/acquisition/preferences/"))
        data = { effective: {}, inherited: {}, overrides: {}, revision: "one" };
      else if (url.pathname === `/api/catalog/works/${id}`) data = work;
      else if (url.pathname === "/api/metadata/books/hardcover/602482")
        data = {
          book,
          stale: true,
          warning: "Showing saved catalog data while Hardcover refreshes.",
        };
      else if (url.pathname.endsWith("/reader-match"))
        data = { status: "matched", book };
      else if (url.pathname.endsWith("/reader-details"))
        data = {
          external_id: "602482",
          contributors: [],
          ratings: [],
          reviews: [],
          series: [],
        };
      else if (url.pathname === `/api/metadata/works/${id}`) {
        requests.push(url);
        const medium = url.searchParams.get("medium");
        const matching = editions.filter((e) => !medium || e.medium === medium);
        const offset = Number(url.searchParams.get("offset") || 0);
        data = {
          sources:
            view === "unlinked"
              ? []
              : [
                  {
                    id: "source",
                    provider: "hardcover",
                    external_id: "602482",
                    title,
                    book,
                    editions_more: true,
                    series: [],
                  },
                ],
          fields: {},
          versions:
            view === "unlinked" ? [] : matching.slice(offset, offset + 20),
          versions_total: view === "unlinked" ? 0 : matching.length,
          cover_choices: [],
          enrichment: null,
        };
      }
      return route.fulfill({ json: data });
    });
    await page.goto(
      view === "discovery"
        ? "/discover/books/hardcover/602482?tab=editions"
        : `/books/${id}?tab=editions`,
    );
    const selector = page.getByRole("combobox", { name: "Edition format" });
    await expect(selector).toBeVisible();
    // Start on a later page: changing the format must reset local/server paging.
    await page
      .getByRole("button", {
        name:
          view === "unlinked"
            ? "Next hardcover editions page"
            : "Next editions page",
        exact: true,
      })
      .click();
    await selector.click();
    await page
      .getByRole("listbox", { name: "Edition format" })
      .getByRole("option", { name: "Audiobook", exact: true })
      .click();
    await expect(
      page.getByText("Tress Graphic Audio", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Print edition 1", { exact: true }),
    ).toHaveCount(0);
    if (view !== "discovery")
      expect(
        requests.some(
          (url) =>
            url.searchParams.get("medium") === "audio" &&
            url.searchParams.get("offset") === "0",
        ),
      ).toBe(true);
    await selector.click();
    await page
      .getByRole("listbox", { name: "Edition format" })
      .getByRole("option", { name: "Ebook", exact: true })
      .click();
    await expect(
      page.getByText("Tress Graphic Audio", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(/More formats may be available/).first(),
    ).toBeVisible();
    if (view === "discovery")
      await expect(
        page.getByText("Showing saved catalog data while Hardcover refreshes."),
      ).toBeVisible();
  });
}
