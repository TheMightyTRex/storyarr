import { expect, test, type Page } from "../fixtures";

async function preferences(page: Page) {
  const reads: string[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "admin",
          role: "admin",
          display_name: "Administrator",
          onboarding_status: "complete",
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path.startsWith("/api/acquisition/preferences/")) {
      reads.push(path);
      data = { effective: {}, inherited: {}, overrides: {}, revision: "one" };
    }
    return route.fulfill({ json: data });
  });
  await page.goto("/settings#preferences");
  const select = page.getByRole("combobox", { name: "Apply to" });
  await expect(select).toHaveValue("personal");
  return { select, reads };
}

test("pointer selection opens the menu and changes application scope exactly once", async ({
  page,
}) => {
  const { select, reads } = await preferences(page);
  await select.click();
  const menu = page.getByRole("listbox", { name: "Apply to" });
  await expect(menu).toBeVisible();
  await menu.getByRole("option", { name: "Everyone on this server" }).click();
  await expect(select).toHaveValue("installation");
  expect(reads).toEqual([
    "/api/acquisition/preferences/personal",
    "/api/acquisition/preferences/installation",
  ]);
  await expect(menu).toBeHidden();
});

for (const fallback of [
  "failed",
  "canceled",
  "unsupported",
  "forced-colors",
] as const) {
  test(`${fallback} popovers leave a working native select`, async ({
    page,
  }) => {
    if (fallback === "forced-colors")
      await page.emulateMedia({ forcedColors: "active" });
    else
      await page.addInitScript((mode) => {
        if (mode === "unsupported")
          Object.defineProperty(HTMLElement.prototype, "showPopover", {
            value: undefined,
          });
        else if (mode === "failed")
          HTMLElement.prototype.showPopover = () => {
            throw new DOMException("Unavailable", "NotSupportedError");
          };
        else
          document.addEventListener(
            "beforetoggle",
            (event) => {
              if ((event as ToggleEvent).newState === "open")
                event.preventDefault();
            },
            true,
          );
      }, fallback);
    const { select, reads } = await preferences(page);
    await select.click();
    await expect(select).not.toHaveAttribute("aria-expanded", "true");
    // Dismiss the OS popup, then use native select typeahead. Arrow keys open
    // platform-specific pickers; typing exercises the browser's DOM selection.
    await page.keyboard.press("Escape");
    await select.focus();
    await page.keyboard.press("e");
    await page.keyboard.press("Tab");
    await expect(select).toHaveValue("installation");
    expect(reads).toEqual([
      "/api/acquisition/preferences/personal",
      "/api/acquisition/preferences/installation",
    ]);
  });
}

test("labels, keyboard, outside dismissal, and modal disabled groups work", async ({
  page,
}) => {
  const { select } = await preferences(page);
  await page
    .locator(".settings-scope-picker")
    .click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("listbox", { name: "Apply to" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(select).toBeFocused();
  await select.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue("installation");
  await select.click();
  await page
    .getByRole("heading", { name: "Download preferences", exact: true })
    .click();
  await expect(page.getByRole("listbox")).toBeHidden();
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.innerHTML =
      '<label>Modal format<select><option value="ebook">Ebook</option><optgroup label="Unavailable" disabled><option value="blocked">Blocked</option></optgroup><option value="audio">Audiobook</option></select></label><output>ebook:0</output>';
    let count = 0;
    dialog.querySelector("select")!.addEventListener("change", (event) => {
      dialog.querySelector("output")!.textContent =
        `${(event.target as HTMLSelectElement).value}:${++count}`;
    });
    document.body.append(dialog);
    dialog.showModal();
  });
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Modal format").click();
  await expect(
    modal.getByRole("option", { name: "Blocked", exact: true }).last(),
  ).toBeDisabled();
  await modal
    .getByRole("listbox")
    .getByRole("option", { name: "Audiobook" })
    .click();
  await expect(modal.locator("output")).toHaveText("audio:1");
});

test.describe("touch", () => {
  test.skip(
    process.env.BOOK_UI_BROWSER === "firefox",
    "Firefox does not support touch emulation",
  );
  test.use({ hasTouch: true });
  test("tapping opens and chooses one scope", async ({ page }) => {
    const { select, reads } = await preferences(page);
    await select.tap();
    await page
      .getByRole("listbox")
      .getByRole("option", { name: "Everyone on this server" })
      .tap();
    await expect(select).toHaveValue("installation");
    expect(reads).toEqual([
      "/api/acquisition/preferences/personal",
      "/api/acquisition/preferences/installation",
    ]);
  });
});
