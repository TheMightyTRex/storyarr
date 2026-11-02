import { expect, test, type Page } from "../fixtures";

// UX-43: the series header with a logo (or the name as a wordmark), and the Change logo slide-out:
// From a cover, Find online (Wikimedia Commons) and Upload your own. Every request is mocked; the
// series, its books and its logo are made up.

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 120"><path d="M38 18h14l3 10h-20zM36 30h18l6 74H30z"/><rect x="24" y="104" width="42" height="8"/><rect x="84" y="30" width="520" height="70"/></svg>`;
// A dark cover with a light block where a series name would be.
const COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#10141c"/><rect x="30" y="24" width="140" height="36" fill="#f2f2f2"/><circle cx="20" cy="30" r="1" fill="#fff"/></svg>`;
const titles = [
  "The Glass Harbour",
  "Salt on the Lamp",
  "The Keeper's Winter",
  "Low Tide Letters",
  "A Light for the Ferry",
  "The Breakwater",
  "Low Water",
];

type Writes = {
  method: string;
  path: string;
  search: string;
  type: string;
  body: Buffer | null;
}[];

async function mockSeries(
  page: Page,
  { role = "admin", withLogo = true } = {},
) {
  const errors: string[] = [];
  const writes: Writes = [];
  let logo: Record<string, unknown> | null = withLogo
    ? {
        url: "/api/catalog/series/hardcover/1042/logo?v=abc",
        format: "svg",
        colour: "text",
        source: "upload",
        source_title: "glass-harbour.svg",
        licence: null,
        source_url: null,
        saved_path: "config/series-logos/hardcover-1042.svg",
        updated_at: "2026-11-02T10:00:00Z",
      }
    : null;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/catalog/cover-image")
      return route.fulfill({ contentType: "image/svg+xml", body: COVER });
    if (
      path === "/api/catalog/series/hardcover/1042/logo" &&
      request.method() === "GET"
    )
      return route.fulfill({ contentType: "image/svg+xml", body: LOGO });
    if (path === "/api/logos/commons/file")
      return route.fulfill({ contentType: "image/svg+xml", body: LOGO });
    if (request.method() !== "GET")
      writes.push({
        method: request.method(),
        path,
        search: url.search,
        type: request.headers()["content-type"] || "",
        body: request.postDataBuffer(),
      });
    let data: unknown = [];
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          role,
          username: "reader",
          display_name: "Reader",
          onboarding_status: "complete",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/catalog/series/hardcover/1042")
      data = {
        external_id: "1042",
        name: "The Glass Harbour",
        description:
          "A harbour town where the lighthouse keeper keeps more than the light. Quiet mysteries, one each winter, told by the people who stay when the boats leave. Every book stands alone, but the town remembers. The seventh book follows the ferry captain through the longest winter the harbour has known.",
        authors: ["Mara Ellison"],
        projection_version: 2,
        generation: 1,
        fetched_at: "2026-11-01T00:00:00Z",
        status: "completed",
        message: "",
        books: 7,
        total: 7,
        raw_total: 8,
        supplements: 1,
        planned: 1,
        owned: 4,
        ebook: 4,
        audio: 2,
        logo,
        items: titles.map((title, i) => ({
          membership_id: `member-${i}`,
          external_id: String(i),
          position: String(i + 1),
          publication: i === 6 ? "unreleased" : "published",
          release_date: i === 6 ? "2027-03-12" : "2020-01-01",
          category: "main",
          compilation: false,
          partial: false,
          merged_record: false,
          ambiguous_position: false,
          work: {
            id: `work-${i}`,
            title,
            authors: ["Mara Ellison"],
            versions: [],
            cover_url: `https://covers.example/${i}.jpg`,
            availability: {
              owned: i < 4,
              ebook: i < 4,
              audio: i < 2,
              stale: false,
            },
          },
        })),
      };
    else if (path === "/api/catalog/series/hardcover/1042/logo") {
      if (request.method() === "DELETE") {
        logo = null;
        return route.fulfill({ status: 204 });
      }
      logo = {
        ...(logo || {}),
        url: "/api/catalog/series/hardcover/1042/logo?v=new",
        format: "png",
        colour: url.searchParams.get("colour") || "text",
        source: url.searchParams.get("source") || "upload",
        source_title: url.searchParams.get("title"),
        saved_path: "config/series-logos/hardcover-1042.png",
      };
      data = logo;
    } else if (path === "/api/catalog/series/hardcover/1042/logo/commons") {
      logo = {
        ...(logo || {}),
        url: "/api/catalog/series/hardcover/1042/logo?v=commons",
        format: "svg",
        colour: "text",
        source: "commons",
        source_title: "Glass Harbour wordmark.svg",
        licence: "Public domain",
        saved_path: "config/series-logos/hardcover-1042.svg",
      };
      data = logo;
    } else if (path === "/api/logos/commons")
      data = {
        items: [
          {
            title: "Harbour Aachen Logo.png",
            thumbnail_url: null,
            width: 800,
            height: 300,
            format: "png",
            licence: "CC BY-SA 4.0",
            source_page:
              "https://commons.wikimedia.org/wiki/File:Harbour_Aachen_Logo.png",
            description: "Logo of a student rowing club",
            probable_wrong_match: true,
          },
          {
            title: "Glass Harbour wordmark.svg",
            thumbnail_url: null,
            width: 640,
            height: 120,
            format: "svg",
            licence: "Public domain",
            source_page:
              "https://commons.wikimedia.org/wiki/File:Glass_Harbour_wordmark.svg",
            description: "Wordmark of The Glass Harbour books by Mara Ellison",
            probable_wrong_match: false,
          },
        ],
      };
    else if (path.endsWith("/main-books")) data = null;
    else if (path.endsWith("/requests")) data = { items: [], total: 0 };
    else if (path === "/api/acquisition/preferences/personal")
      data = { effective: { desired_media: "both" } };
    else if (path === "/api/acquisition/profiles")
      data = [
        {
          id: null,
          name: "My defaults",
          preferences: {
            desired_media: "both",
            source_order: [],
            criteria: [],
            preferred_narrators: [],
            ebook_formats: [],
            audio_formats: [],
            blocked_formats: [],
          },
          overrides: {},
          origins: {},
        },
      ];
    return route.fulfill({ json: data });
  });
  return { errors, writes };
}

async function openPanel(page: Page) {
  await page.getByRole("button", { name: "Change logo", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Series logo" });
  await expect(panel).toBeVisible();
  return panel;
}

test("the series header shows the logo in one colour, the meta line, progress and a fan of covers", async ({
  page,
}) => {
  const { errors } = await mockSeries(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/series/hardcover/1042");
  const header = page.locator(".series-head");
  await expect(
    header.getByRole("img", { name: "The Glass Harbour", exact: true }),
  ).toBeVisible();
  const heading = page.getByRole("heading", {
    level: 1,
    name: "The Glass Harbour",
  });
  await expect(heading).not.toHaveClass(/wordmark/);
  await expect(header.locator(".series-head__meta")).toContainText(
    "By Mara Ellison7 books and 1 supplementary bookNext: book 7, Low Water, 12 March 2027",
  );
  await expect(
    header.getByRole("link", { name: "Mara Ellison" }),
  ).toHaveAttribute("href", "/search?q=Mara%20Ellison");
  // The short description stops at a sentence; the whole text is under About.
  await expect(header.locator(".series-head__desc")).toHaveText(
    "A harbour town where the lighthouse keeper keeps more than the light. Quiet mysteries, one each winter, told by the people who stay when the boats leave. Every book stands alone, but the town remembers.",
  );
  await expect(header).toContainText(
    "4 of 7 books in your library (4 ebooks, 2 audiobooks)",
  );
  await expect(header.locator(".cover-fan img")).toHaveCount(4);
  await expect(header.locator(".cover-fan")).toBeVisible();
  const mask = await header.locator(".logo-mask").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      mask: style.maskImage || style.webkitMaskImage,
      colour: element.dataset.colour,
    };
  });
  expect(mask.mask).toContain("/api/catalog/series/hardcover/1042/logo");
  expect(mask.colour).toBe("text");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(header.locator(".cover-fan")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("without a logo the name is a wordmark, and only admins can add one", async ({
  page,
}) => {
  await mockSeries(page, { role: "member", withLogo: false });
  await page.goto("/series/hardcover/1042");
  await expect(
    page.getByRole("heading", { level: 1, name: "The Glass Harbour" }),
  ).toHaveClass(/wordmark/);
  await expect(page.locator(".series-head .logo-mask")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /logo/ })).toHaveCount(0);
});

test("the logo slide-out keeps focus inside, moves between ways with arrow keys and gives focus back", async ({
  page,
}) => {
  await mockSeries(page);
  await page.goto("/series/hardcover/1042");
  const opener = page.getByRole("button", { name: "Change logo", exact: true });
  const panel = await openPanel(page);
  await expect(
    panel.getByRole("button", { name: "Close series logo" }),
  ).toBeFocused();
  await expect(
    panel.getByText("config/series-logos/hardcover-1042.svg"),
  ).toBeVisible();
  await expect(panel.getByText("Uploaded: glass-harbour.svg")).toBeVisible();
  const cover = panel.getByRole("tab", { name: "From a cover" });
  await expect(cover).toHaveAttribute("aria-selected", "true");
  await cover.focus();
  await page.keyboard.press("ArrowRight");
  const find = panel.getByRole("tab", { name: "Find online" });
  await expect(find).toBeFocused();
  await expect(find).toHaveAttribute("aria-selected", "true");
  await expect(
    panel.getByRole("tabpanel", { name: "Find online" }),
  ).toBeVisible();
  await page.keyboard.press("End");
  await expect(
    panel.getByRole("tab", { name: "Upload your own" }),
  ).toBeFocused();
  await page.keyboard.press("Home");
  await expect(cover).toBeFocused();
  // Tab stays inside the panel.
  for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
  expect(
    await panel.evaluate((element) => element.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(opener).toBeFocused();
});

test("cutting the logo out of a cover uploads a PNG", async ({ page }) => {
  const { writes } = await mockSeries(page);
  await page.goto("/series/hardcover/1042");
  const panel = await openPanel(page);
  await expect(panel.getByRole("radio", { name: /Book 1/ })).toBeChecked();
  const status = panel.locator(".logo-crop__controls [role=status]");
  await expect(status).toContainText("pixels");
  // The cover is dark with a light logo, so Invert is suggested.
  await expect(panel.getByRole("switch", { name: /Invert/ })).toBeChecked();
  const canvas = panel.getByRole("img", {
    name: "2. Draw a box around the logo",
  });
  const readout = panel.locator(".logo-crop__readout");
  const before = await readout.textContent();
  await canvas.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(readout).not.toHaveText(before || "");
  await expect(readout).toContainText("5% from the top");
  await page.keyboard.press("ArrowUp");
  await expect(panel.locator(".logo-preview .logo-mask")).toHaveCount(2);
  await expect(panel.getByText("(cut from book 1)")).toBeVisible();
  await panel.getByRole("button", { name: "Save logo" }).click();
  await expect(panel).toBeHidden();
  const put = writes.find((write) => write.method === "PUT");
  expect(put?.path).toBe("/api/catalog/series/hardcover/1042/logo");
  const query = new URLSearchParams(put?.search);
  expect(query.get("source")).toBe("cover");
  expect(query.get("title")).toBe("the cover of The Glass Harbour, book 1");
  expect(put?.type).toBe("image/png");
  expect(put?.body?.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  await expect(
    page.getByRole("status").filter({ hasText: "Logo saved" }),
  ).toContainText("config/series-logos/hardcover-1042.png");
});

test("Find online shows the licence, warns about a wrong match and copies the chosen file", async ({
  page,
}) => {
  const { writes } = await mockSeries(page);
  await page.goto("/series/hardcover/1042");
  const panel = await openPanel(page);
  await panel.getByRole("tab", { name: "Find online" }).click();
  await expect(panel.getByLabel("Series name")).toHaveValue(
    "The Glass Harbour",
  );
  await panel.getByRole("button", { name: "Search", exact: true }).click();
  await expect(panel.getByText("1 possible logo found.")).toBeVisible();
  const results = panel.locator(".logo-candidate");
  await expect(results).toHaveCount(2);
  await expect(results.first()).toContainText(
    "Probably not this series: it does not mention Mara Ellison",
  );
  await expect(results.first()).toContainText("Licence: CC BY-SA 4.0");
  await expect(results.nth(1).locator(".chip")).toHaveCount(0);
  await results
    .nth(1)
    .getByRole("button", { name: "Use this logo", exact: true })
    .click();
  await expect(results.nth(1)).toHaveAttribute("aria-current", "true");
  // The chosen file opens in the same editor, read through Storyarr; a logo file with no background
  // keeps its own shape.
  await expect(
    panel.getByRole("radio", { name: "Transparency" }),
  ).toBeChecked();
  await expect(panel.getByText(/^\d+ by \d+ pixels/)).toBeVisible();
  await expect(panel.getByRole("radio", { name: "Most" })).toBeVisible();
  await panel
    .getByRole("radio", { name: "Accent colour" })
    .check({ force: true });
  await panel.getByRole("button", { name: "Save logo" }).click();
  await expect(panel).toBeHidden();
  // Saved as the edited PNG; the server reads the licence from Commons for the file name.
  const put = writes.find(
    (write) => write.method === "PUT" && write.path.endsWith("/logo"),
  );
  expect(put!.type).toBe("image/png");
  expect(new URLSearchParams(put!.search).get("source")).toBe("commons");
  expect(new URLSearchParams(put!.search).get("title")).toBe(
    "Glass Harbour wordmark.svg",
  );
  expect(new URLSearchParams(put!.search).get("colour")).toBe("accent");
});

test("the eraser and paintbrush change the cut-out, and Undo takes an edit back", async ({
  page,
}) => {
  await mockSeries(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/series/hardcover/1042");
  const panel = await openPanel(page);
  await panel.getByRole("tab", { name: "Upload your own" }).click();
  await panel.locator('input[type="file"]').setInputFiles({
    name: "harbour.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(LOGO),
  });
  const status = panel.getByText(/^\d+ by \d+ pixels/);
  await expect(status).toBeVisible();
  const before = await status.textContent();
  await panel.getByRole("radio", { name: "Eraser" }).check({ force: true });
  await panel.getByRole("radio", { name: "Medium" }).check({ force: true });
  const cut = panel.getByRole("img", { name: /^Cut-out/ });
  const box = (await cut.boundingBox())!;
  // Rub out a stripe across the middle of the long bar.
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.6, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(status).toContainText("1 edit");
  await panel.getByRole("button", { name: "Undo last edit" }).click();
  await expect(status).toHaveText(before!);
  await panel.getByRole("radio", { name: "Paintbrush" }).check({ force: true });
  await page.mouse.click(box.x + 4, box.y + 4);
  await expect(status).toContainText("1 edit");
  await panel.getByRole("button", { name: "Clear edits" }).click();
  await expect(status).toHaveText(before!);
});

test("Remove takes the logo away and focus stays in the panel", async ({
  page,
}) => {
  const { writes } = await mockSeries(page);
  await page.goto("/series/hardcover/1042");
  const panel = await openPanel(page);
  await panel.getByRole("button", { name: "Remove logo" }).click();
  const none = panel.getByText(
    "No logo saved. The series name is shown as a wordmark.",
  );
  await expect(none).toBeFocused();
  expect(writes.some((write) => write.method === "DELETE")).toBe(true);
  await panel.getByRole("button", { name: "Close series logo" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "The Glass Harbour" }),
  ).toHaveClass(/wordmark/);
});

test("the preview follows the colour choice and shows an uploaded file", async ({
  page,
}) => {
  const { errors } = await mockSeries(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/series/hardcover/1042");
  const panel = await openPanel(page);
  const light = panel.getByRole("img", { name: "Logo on the light theme" });
  const dark = panel.getByRole("img", { name: "Logo on the dark theme" });
  const paint = (mask: typeof light) =>
    mask.evaluate((element) => getComputedStyle(element).backgroundColor);
  // Text colour: near black on the light preview, near white on the dark one.
  await expect.poll(() => paint(light)).toBe("rgb(20, 20, 22)");
  await expect.poll(() => paint(dark)).toBe("rgb(243, 244, 246)");
  await panel
    .getByRole("radio", { name: "Accent colour" })
    .check({ force: true });
  await expect.poll(() => paint(light)).toBe("rgb(11, 95, 90)");
  await expect.poll(() => paint(dark)).toBe("rgb(94, 211, 198)");
  // An uploaded file is previewed straight away, from an address the page may show.
  await panel.getByRole("tab", { name: "Upload your own" }).click();
  await panel.locator('input[type="file"]').setInputFiles({
    name: "harbour.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(LOGO),
  });
  await expect(
    panel.getByText("(harbour.svg)", { exact: false }),
  ).toBeVisible();
  const shown = await light.evaluate((element) => {
    const style = getComputedStyle(element);
    return (style.maskImage || style.webkitMaskImage).slice(0, 15);
  });
  expect(shown).toMatch(/^url\("data:image/);
  expect(errors).toEqual([]);
});
