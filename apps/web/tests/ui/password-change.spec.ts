import { expect, test } from "../fixtures";

// Security check, 3 November 2026: there was no way to change or reset a password.
const admin = {
  id: "admin",
  username: "admin",
  display_name: "Admin",
  role: "admin",
  active: true,
  permissions: ["admin", "manage_users"],
  access_label: "Administrator",
  library_ids: [],
  onboarding_status: "complete",
};

test("people change their own password on Settings, Sign-in", async ({
  page,
}) => {
  const bodies: unknown[] = [];
  let wrong = true;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me")
      return route.fulfill({ json: { user: admin, csrf_token: "test" } });
    if (path === "/api/auth/oidc/link")
      return route.fulfill({
        json: { password_available: true, linked: false, issuer: null },
      });
    if (path === "/api/auth/oidc")
      return route.fulfill({ json: { enabled: false, label: null } });
    if (path === "/api/auth/password" && request.method() === "PUT") {
      bodies.push(request.postDataJSON());
      if (wrong) {
        wrong = false;
        return route.fulfill({
          status: 422,
          json: { detail: "Your current password is incorrect" },
        });
      }
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/settings#sign-in");
  const form = page.getByRole("form", { name: "Change password" });
  await form.getByLabel("Current password").fill("not it");
  await form.getByLabel("New password").fill("a brand new password");
  await form.getByRole("button", { name: "Change password" }).click();
  await expect(form.getByRole("alert")).toContainText(
    "Your current password is incorrect",
  );
  await form.getByLabel("Current password").fill("the old password");
  await form.getByRole("button", { name: "Change password" }).click();
  await expect(form.getByRole("status")).toHaveText(
    "Password changed. Your other browsers and devices are signed out.",
  );
  await expect(form.getByLabel("New password")).toHaveValue("");
  expect(bodies.at(-1)).toEqual({
    current_password: "the old password",
    new_password: "a brand new password",
  });
});

test("an administrator sets a new password for someone else", async ({
  page,
}) => {
  const reader = {
    ...admin,
    id: "reader",
    username: "reader",
    display_name: "Reader",
    role: "member",
    permissions: ["request"],
    access_label: "Member",
  };
  const resets: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: unknown = [];
    if (path === "/api/auth/me") data = { user: admin, csrf_token: "test" };
    else if (path === "/api/setup/onboarding") data = { status: "completed" };
    else if (path === "/api/auth/access")
      data = { presets: [], roles: [], permissions: [] };
    else if (path === "/api/auth/users") data = [admin, reader];
    else if (path === "/api/auth/users/reader/sign-in")
      data = {
        local_password: true,
        oidc: false,
        plex: false,
        revision: "one",
      };
    else if (path === "/api/auth/users/reader/password") {
      resets.push(request.postDataJSON());
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ json: data });
  });
  await page.goto("/settings#accounts");
  await page
    .getByRole("button", { name: "Account details for Reader", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Account details for Reader",
  });
  const button = dialog.getByRole("button", { name: "Set new password" });
  await dialog.getByLabel("New password").fill("too short");
  await expect(button).toBeDisabled();
  await dialog.getByLabel("New password").fill("a password from the admin");
  await button.click();
  await expect(dialog.getByRole("status").last()).toHaveText(
    "New password set for Reader. They are signed out everywhere.",
  );
  expect(resets).toEqual([{ password: "a password from the admin" }]);
});
