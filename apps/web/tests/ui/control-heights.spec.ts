import { expect, test, type Page } from "../fixtures";

// UX-40: every button, link button, input and select is the shared library's 44px (--control-h), and
// controls that sit side by side share one height. Measured in the browser, not read from the CSS.

const libraryId = "11111111-1111-4111-8111-111111111111";
const books = ["A Wizard of Earthsea", "Project Hail Mary", "Piranesi"].map(
  (title, i) => ({
    id: `book-${i}`,
    title,
    authors: ["An Author"],
    library_id: libraryId,
    availability: { owned: true, ebook: i !== 1, audio: i !== 0, stale: false },
  }),
);
const request = (id: string, title: string, target: object) => ({
  id,
  work_id: id,
  work_title: title,
  authors: ["Andy Weir"],
  owner_name: "Reader",
  can_open_book: true,
  can_withdraw: true,
  can_decide: false,
  approval_status: "approved",
  specification: { mode: "audio" },
  reasons: [{ id: `${id}-r`, active: true, label: "Your request" }],
  targets: [
    { slot: "audio", state: "wanted", next_action: "downloads", ...target },
  ],
});

async function mock(page: Page) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.includes("/cover")) return route.fulfill({ status: 404 });
    let data: unknown = page.url().includes("/settings")
      ? []
      : { items: [], total: 0, offset: 0, limit: 40 };
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "admin",
          role: "admin",
          username: "admin",
          display_name: "Reader",
          onboarding_status: "completed",
          permissions: [],
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/library/libraries")
      data = [{ id: libraryId, name: "My books" }];
    else if (path === "/api/library/books")
      data = { items: books, total: books.length, offset: 0, limit: 40 };
    else if (path === "/api/request-quotas/me")
      data = { bypass: true, windows: [], pending_remaining: null };
    else if (path.includes("/acquisition/preferences/"))
      data = {
        revision: "one",
        overrides: {},
        inherited: {},
        inherited_origins: {},
        effective: { desired_media: "both" },
      };
    else if (path === "/api/requests/counts")
      data = { pending: 0, downloading: 1, review: 1, active: 2 };
    else if (path === "/api/requests")
      data = {
        items: [
          request("download", "Project Hail Mary", {
            attempt_id: "t",
            attempt_state: "downloading",
            progress: 0.42,
          }),
          request("review", "The Martian", {
            attempt_id: "h",
            attempt_state: "complete",
            progress: 1,
            needs_review: true,
            import_state: "held",
            inspection_id: "i",
          }),
        ],
        total: 2,
        offset: 0,
        limit: 10,
      };
    return route.fulfill({ json: data });
  });
}

/** Every visible control, with framed controls (toolbar search and menus) measured by their frame. */
async function controls(page: Page) {
  return page.evaluate(() => {
    const frame = ".toolbar-search, .toolbar-menu, .quick-add-split";
    const selector = [
      // A cover's own button is the cover itself (the whole card opens the Summary), not a control.
      "button:not(.cover-card__open)",
      "select",
      "input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]):not([type=file])",
      ".button-link",
      ".control-action",
      ".reader-action-link",
      ".btn",
    ].join(",");
    const seen = new Set<Element>();
    const found: {
      name: string;
      top: number;
      bottom: number;
      left: number;
      right: number;
      height: number;
      width: number;
      icon: boolean;
    }[] = [];
    for (const node of document.querySelectorAll(selector)) {
      const el = node.closest(frame) || node;
      if (seen.has(el)) continue;
      seen.add(el);
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || el.closest("[hidden], [inert]"))
        continue;
      found.push({
        name:
          el.getAttribute("aria-label") ||
          el.textContent?.trim().slice(0, 30) ||
          el.className.toString(),
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        height: Math.round(box.height * 10) / 10,
        width: Math.round(box.width * 10) / 10,
        icon:
          !!el.querySelector("svg") &&
          !el.textContent?.trim() &&
          el.matches("button, a"),
      });
    }
    return found;
  });
}

function check(found: Awaited<ReturnType<typeof controls>>, page: string) {
  expect(found.length, `${page}: controls found`).toBeGreaterThan(2);
  for (const control of found) {
    expect(control.height, `${page}: ${control.name}`).toBeGreaterThanOrEqual(
      44,
    );
    if (control.icon)
      expect(control.width, `${page}: ${control.name} is square`).toBe(
        control.height,
      );
  }
  // Side by side: on the same row and less than 24px apart.
  for (const a of found)
    for (const b of found) {
      if (a === b || a.left >= b.left) continue;
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlap <= 0 || b.left - a.right > 24) continue;
      expect(
        Math.abs(a.height - b.height),
        `${page}: ${a.name} and ${b.name} sit side by side`,
      ).toBeLessThanOrEqual(0.5);
    }
}

for (const width of [1440, 390])
  test(`controls are 44px and side by side controls match at ${width}px`, async ({
    page,
  }) => {
    await mock(page);
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path, ready] of [
      ["My library", "/library", page.getByRole("searchbox")],
      [
        "Activity",
        "/requests",
        page.getByRole("table", {
          name: "Book requests and download activity",
        }),
      ],
      [
        "Download preferences",
        "/settings#preferences",
        page.getByLabel("Apply to"),
      ],
    ] as const) {
      await page.goto(path);
      await expect(ready.first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      check(await controls(page), `${name} at ${width}px`);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${name} at ${width}px does not scroll sideways`,
      ).toBe(true);
    }
  });
