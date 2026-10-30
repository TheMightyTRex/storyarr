import { expect, test } from "../fixtures";

test("admins delete a library copy into the holding folder or permanently", async ({
  page,
}) => {
  const id = "00000000-0000-0000-0000-000000000211";
  const requests: Record<string, unknown>[] = [];
  const copy = {
    id: "audio-copy",
    version_id: "audio-copy",
    medium: "audio",
    title: "Mort",
    library_name: "Audiobooks",
    server_kind: "audiobookshelf",
    narrators: [],
    formats: ["mp3"],
    state: "present",
    full_content: true,
    work_ids: [id],
    open_url: "https://library.example/item/1",
    files: [{ path: "/audiobooks/Terry Pratchett/Mort/01.mp3", format: "mp3" }],
  };
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    let data: unknown = {};
    if (url.pathname === "/api/auth/me")
      data = {
        user: {
          id: "admin",
          role: "admin",
          username: "admin",
          display_name: "Admin",
        },
        csrf_token: "test",
      };
    else if (url.pathname === "/api/setup/onboarding")
      data = { status: "completed" };
    else if (url.pathname === `/api/catalog/works/${id}`)
      data = {
        id,
        title: "Mort",
        authors: ["Terry Pratchett"],
        availability: { owned: true, ebook: false, audio: true, stale: false },
      };
    else if (url.pathname === `/api/metadata/works/${id}`)
      data = { sources: [], fields: {}, versions: [], versions_total: 0 };
    else if (url.pathname.endsWith("/reader-match"))
      data = { status: "unmatched", book: null };
    else if (url.pathname.startsWith("/api/acquisition/preferences/"))
      data = { effective: { desired_media: "audio" } };
    else if (url.pathname.endsWith("/part-sets")) data = [];
    else if (url.pathname === "/api/library/assets")
      data = { items: [copy], total: 1, offset: 0, limit: 40 };
    else if (url.pathname === "/api/automation/settings/installation")
      data = {
        settings: { deleted_retention_days: 30 },
        built_in: { deleted_retention_days: 30 },
        generation: 1,
      };
    else if (url.pathname === "/api/library/assets/audio-copy/delete") {
      const body = route.request().postDataJSON();
      requests.push(body);
      data = {
        held_path:
          body.files === "hold"
            ? "/data/media/audiobooks/.deleted-books/2026-10-30/Terry Pratchett/Mort"
            : null,
        withdrawn_requests: 0,
        original_path: "/data/media/audiobooks/Terry Pratchett/Mort",
        excluded_from_lists: 1,
        removed_from_lists: 0,
        message: "Moved to the holding folder and removed from Audiobookshelf",
      };
    } else if (url.pathname.endsWith("/cover"))
      return route.fulfill({ status: 404 });
    return route.fulfill({ json: data });
  });
  await page.goto(`/books/${id}?tab=library#library-copies`);
  const copies = page.getByRole("region", { name: "Library copies" });
  await copies.getByRole("button", { name: "Delete", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Delete · Mort" });
  await expect(
    dialog.getByRole("radio", {
      name: "Move to the holding folder (deleted after 30 days)",
    }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", {
      name: "Block this book from future downloads",
    }),
  ).toBeChecked();
  await dialog.getByRole("radio", { name: "Delete permanently" }).check();
  const confirm = dialog.getByRole("button", { name: "Delete permanently" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
  await expect(confirm).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await copies.getByRole("button", { name: "Delete", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Delete · Mort" });
  await dialog.getByRole("button", { name: "Move and remove" }).click();
  await expect(dialog.getByText(".deleted-books/2026-10-30")).toBeVisible();
  await expect(dialog.getByText("To recover this book")).toBeVisible();
  await expect(
    dialog.getByText("/data/media/audiobooks/Terry Pratchett/Mort"),
  ).toBeVisible();
  await expect(dialog.getByText("Blocked from future downloads")).toBeVisible();
  expect(requests).toEqual([{ files: "hold", forget: true }]);
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.goto(`/books/${id}?tab=overview`);
  await page
    .locator(".reader-actions")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Delete · Mort" });
  await expect(dialog.getByText("can’t be undone")).toHaveCount(0);
  await dialog.getByRole("radio", { name: "Delete permanently" }).check();
  await expect(dialog.getByText("This can’t be undone.")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
});
