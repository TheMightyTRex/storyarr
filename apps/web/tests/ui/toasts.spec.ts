import { expect, test, type Page } from "../fixtures";

// The shared library's toasts (option C) and saved note (option D), through the radio library setting:
// Read again shows an information toast, and saving shows "Saved at 16:31" beside the buttons.
async function setup(page: Page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          user: {
            id: "user",
            role: "admin",
            display_name: "Reader",
            onboarding_status: "complete",
          },
          csrf_token: "test",
        },
      });
    if (path === "/api/setup/onboarding")
      return route.fulfill({ json: { status: "completed" } });
    if (path === "/api/radio/library/sync")
      return route.fulfill({ status: 202, body: "" });
    if (path === "/api/radio/library")
      return route.fulfill({
        json: {
          current: {
            integration_id: "abs",
            server_name: "Home ABS",
            library_id: "radio-lib",
            name: "Radio",
            abs_folder: "/radio",
            local_path: "/media/radio",
            synced_at: "2026-11-02T21:40:00Z",
            last_error: null,
            files: 12,
            linked: 10,
          },
          options: [
            {
              integration_id: "abs",
              server_name: "Home ABS",
              library_id: "radio-lib",
              name: "Radio",
              folders: ["/radio"],
            },
          ],
          errors: [],
        },
      });
    return route.fulfill({ json: [] });
  });
}

test("toasts stack in the corner, close by name and wait under the pointer", async ({
  page,
}) => {
  await page.clock.install();
  await setup(page);
  await page.goto("/settings#libraries");
  const block = page.getByRole("region", { name: "Radio library" });
  const again = block.getByRole("button", { name: "Read again" });
  const toasts = page.locator(".toasts .toast");

  for (let n = 0; n < 4; n++) await again.click();
  // Up to three, newest at the bottom, in one status region.
  await expect(toasts).toHaveCount(3);
  await expect(page.locator(".toasts")).toHaveAttribute("role", "status");
  const first = toasts.first();
  await expect(first).toHaveAttribute("data-tone", "info");
  await expect(first).toContainText("Reading the radio library");
  await expect(first).toContainText("This takes a minute.");
  const box = await toasts.last().boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x + box!.width).toBeGreaterThan(viewport.width - 40);
  expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 40);

  // Close is named with the message.
  await toasts
    .last()
    .getByRole("button", { name: "Close message: Reading the radio library" })
    .click();
  await expect(toasts).toHaveCount(2);

  // It waits while the pointer is on it, then goes 5 seconds after.
  await first.hover();
  await page.clock.fastForward(8000);
  await expect(toasts).toHaveCount(1);
  await page.mouse.move(0, 0);
  await page.clock.fastForward(5000);
  await expect(toasts).toHaveCount(0);
});

test("a settings save shows a saved note, not a toast, until the next change", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/radio/library", (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    return route.fulfill({
      json: {
        integration_id: "abs",
        server_name: "Home ABS",
        library_id: "radio-lib",
        name: "Radio",
        abs_folder: "/radio",
        local_path: "/media/radio",
        synced_at: null,
        last_error: null,
        files: 0,
        linked: 0,
      },
    });
  });
  await page.goto("/settings#libraries");
  const block = page.getByRole("region", { name: "Radio library" });
  await block.getByRole("button", { name: "Change" }).click();
  await block.getByRole("button", { name: "Save radio library" }).click();
  await expect(block.locator(".saved-note")).toHaveText(
    /^Saved at \d\d:\d\d\. Storyarr is reading it now\.$/,
  );
  await expect(page.locator(".toasts .toast")).toHaveCount(0);
  await block.getByRole("button", { name: "Change" }).click();
  await expect(block.locator(".saved-note")).toBeHidden();
});
